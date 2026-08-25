/**
 * In-app updates, served from the same GitHub releases people used to download
 * by hand. electron-updater reads `latest-mac.yml` / `latest.yml` from the
 * newest release, compares it against this build, and — on macOS — hands the
 * zip to Squirrel.Mac, which swaps the bundle and relaunches.
 *
 * Two ways in: a quiet check a while after launch, and the Check for Updates…
 * menu item. They share one code path; `interactive` decides whether a
 * non-event (already current, or no network) is worth a dialog, and whether a
 * version the user chose to skip is offered again.
 *
 * The automatic check is deliberately cheap at launch. Nothing here runs, is
 * required or is read from disk while the first window is being built: the
 * whole cost of starting jmd is one unref'd timer, and even when that fires,
 * a check that is not due yet returns before electron-updater is loaded or a
 * request goes out.
 *
 * macOS will only install an update over a signed app, so this does nothing
 * useful for a build made without the notarization credentials — the check
 * fails with a code-signature error rather than silently installing nothing.
 */
const { app, BrowserWindow, dialog, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const RELEASES_URL = 'https://github.com/jojonki/jmd/releases';

/**
 * How long the automatic check waits before looking again. Someone who opens
 * jmd twenty times a day is asked once; someone who opens it after a month
 * away is asked on the launch they actually came back on.
 */
const AUTO_CHECK_INTERVAL = 24 * 60 * 60 * 1000;

/**
 * How long after launch the automatic check runs. Late on purpose: at launch
 * the window is still loading, and a dialog landing over a half-drawn editor
 * reads as a crash. Waiting also means a run short enough to be a mistaken
 * double-click never gets interrupted.
 */
const STARTUP_DELAY = 8000;

/** Required lazily: an unpackaged run never needs it. */
let updater = null;

/** A check or a download is already running; a second one would race it. */
let busy = false;

/** Set once a downloaded update is staged, so we stop offering it again. */
let staged = false;

/** The user asked to restart, and the windows are being closed for it. */
let installing = false;

// ------------------------------------------------------------------- state

/**
 * What the last check left behind: when it ran, and the one version the user
 * asked not to be told about again. Small enough to keep in a file of its own
 * rather than in the renderer's settings, which the main process cannot read.
 * @type {{ lastCheckAt: number, skipped: string|null }|null}
 */
let state = null;

/** Resolved on first use — `app.getPath` is not available before ready. */
function stateFile() {
  return path.join(app.getPath('userData'), 'update-state.json');
}

async function readState() {
  if (state) return state;
  let stored = null;
  try {
    stored = JSON.parse(await fs.readFile(stateFile(), 'utf8'));
  } catch {
    /* no state yet, or a file we cannot parse: start over from nothing */
  }
  state = {
    lastCheckAt: Number(stored?.lastCheckAt) || 0,
    skipped: typeof stored?.skipped === 'string' ? stored.skipped : null,
  };
  // A skip that names the version now running has done its job — most likely
  // the update was installed by hand afterwards.
  if (state.skipped === app.getVersion()) state.skipped = null;
  return state;
}

async function writeState(patch) {
  state = { ...(await readState()), ...patch };
  try {
    await fs.writeFile(stateFile(), JSON.stringify(state));
  } catch {
    /* an unwritable state file costs an extra check, and nothing more */
  }
}

/**
 * Whether the automatic check should go out. A `lastCheckAt` in the future is
 * a clock that moved, not a check that ran: treat it as due rather than as a
 * reason to stay quiet until it catches up.
 */
function isCheckDue({ lastCheckAt }, now = Date.now()) {
  const elapsed = now - lastCheckAt;
  return elapsed < 0 || elapsed >= AUTO_CHECK_INTERVAL;
}

function getUpdater() {
  if (!updater) {
    updater = require('electron-updater').autoUpdater;
    // Downloads are ~100 MB. Ask first rather than spending someone's tethered
    // connection for them.
    updater.autoDownload = false;
    // The safety net for "Later", and for a restart the user cancels out of:
    // whenever the app is next quit for real, the staged update goes in.
    updater.autoInstallOnAppQuit = true;
  }
  return updater;
}

/** The window a dialog should hang off, if any window is open at all. */
function parentWindow() {
  return BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || null;
}

function show(options) {
  const parent = parentWindow();
  return parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options);
}

/**
 * @param {object} [options]
 * @param {boolean} [options.interactive] true when the user asked, which is
 *   what makes "you are up to date" and errors worth reporting — and what
 *   brings back a version they had skipped.
 */
async function checkForUpdates({ interactive = false } = {}) {
  if (busy) return;

  if (!app.isPackaged) {
    if (interactive) {
      await show({
        type: 'info',
        message: 'Updates are only available in the installed app.',
        detail: 'This is a development build running from source.',
      });
    }
    return;
  }

  if (staged) {
    if (interactive) await offerRestart();
    return;
  }

  busy = true;
  try {
    const result = await getUpdater().checkForUpdates();
    await writeState({ lastCheckAt: Date.now() });
    if (result?.isUpdateAvailable) {
      const version = result.updateInfo.version;
      // Skipping silences the automatic check for that one release; asking
      // for a check by hand is asking about it again.
      if (!interactive && version === (await readState()).skipped) return;
      await offerDownload(version);
      return;
    }
    if (interactive) {
      await show({
        type: 'info',
        message: `${app.name} is up to date.`,
        detail: `You are running version ${app.getVersion()}.`,
      });
    }
  } catch (error) {
    if (interactive) await reportFailure(error);
  } finally {
    busy = false;
  }
}

async function offerDownload(version) {
  const { response } = await show({
    type: 'info',
    buttons: ['Download', 'Later', 'Skip This Version'],
    defaultId: 0,
    cancelId: 1,
    message: `${app.name} ${version} is available.`,
    detail: `You are running ${app.getVersion()}. The update downloads in the `
      + 'background; you will be asked before it is installed.\n\n'
      + `Later asks again on another day. Skip This Version drops ${version} `
      + 'for good — the next release is still offered, and Check for Updates… '
      + 'brings this one back.',
  });
  if (response === 2) {
    await writeState({ skipped: version });
    return;
  }
  if (response !== 0) return;

  // The window's progress bar is the only feedback during the download, so the
  // app stays usable instead of sitting behind a modal for a hundred megabytes.
  const onProgress = ({ percent }) => setProgress(percent / 100);
  const api = getUpdater();
  api.on('download-progress', onProgress);
  try {
    await api.downloadUpdate();
    staged = true;
    await offerRestart();
  } catch (error) {
    await reportFailure(error);
  } finally {
    api.off('download-progress', onProgress);
    setProgress(-1);
  }
}

async function offerRestart() {
  const { response } = await show({
    type: 'info',
    buttons: ['Restart Now', 'Later'],
    defaultId: 0,
    cancelId: 1,
    message: 'The update is ready to install.',
    detail: `${app.name} will restart to finish installing. If you would rather `
      + 'not stop now, the update is applied the next time you quit.',
  });
  if (response === 0) restartAndInstall();
}

/**
 * Squirrel replaces the bundle and relaunches, so the app has to be able to go
 * down cleanly first. Asking each window to close runs its unsaved-changes
 * prompt; only once they are all gone is it safe to hand over.
 *
 * Prepended so it runs before the app's own window-all-closed handler, which
 * quits outright on Windows and Linux.
 */
function restartAndInstall() {
  installing = true;
  app.prependOnceListener('window-all-closed', () => {
    if (!installing) return;
    setProgress(-1);
    getUpdater().quitAndInstall();
  });
  for (const win of BrowserWindow.getAllWindows()) win.close();
}

/**
 * Called when someone answers Cancel to an unsaved-changes prompt, which is
 * how a restart gets called off: the windows stay open, so the listener above
 * must not fire the next time they all happen to be closed. The update is
 * already on disk either way and goes in on the next ordinary quit
 * (`autoInstallOnAppQuit`).
 */
function cancelPendingInstall() {
  installing = false;
}

function setProgress(fraction) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.setProgressBar(fraction);
  }
}

async function reportFailure(error) {
  const { response } = await show({
    type: 'error',
    buttons: ['Open Releases', 'OK'],
    defaultId: 1,
    cancelId: 1,
    message: 'Could not update automatically.',
    detail: `${error?.message ?? error}\n\nYou can download the new version by hand instead.`,
  });
  if (response === 0) shell.openExternal(RELEASES_URL);
}

/**
 * The check that runs on its own, once a day at most. Everything it needs —
 * the state file, electron-updater, the network — is reached only from inside
 * the timer, and only on the launch where a check is actually due, so an
 * ordinary start pays for a timer and nothing else.
 */
function checkOnStartup() {
  if (!app.isPackaged) return;
  setTimeout(async () => {
    if (!isCheckDue(await readState())) return;
    await checkForUpdates({ interactive: false });
  }, STARTUP_DELAY).unref();
}

module.exports = { checkForUpdates, checkOnStartup, cancelPendingInstall, isCheckDue };
