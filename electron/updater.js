/**
 * In-app updates, served from the same GitHub releases people used to download
 * by hand. electron-updater reads `latest-mac.yml` / `latest.yml` from the
 * newest release, compares it against this build, and — on macOS — hands the
 * zip to Squirrel.Mac, which swaps the bundle and relaunches.
 *
 * Two ways in: a quiet check shortly after launch, and the Check for Updates…
 * menu item. They share one code path; `interactive` decides whether a
 * non-event (already current, or no network) is worth a dialog.
 *
 * macOS will only install an update over a signed app, so this does nothing
 * useful for a build made without the notarization credentials — the check
 * fails with a code-signature error rather than silently installing nothing.
 */
const { app, BrowserWindow, dialog, shell } = require('electron');

const RELEASES_URL = 'https://github.com/jojonki/jmd/releases';

/** Required lazily: an unpackaged run never needs it. */
let updater = null;

/** A check or a download is already running; a second one would race it. */
let busy = false;

/** Set once a downloaded update is staged, so we stop offering it again. */
let staged = false;

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
 *   what makes "you are up to date" and errors worth reporting.
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
    if (result?.isUpdateAvailable) {
      await offerDownload(result.updateInfo.version);
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
    buttons: ['Download', 'Later'],
    defaultId: 0,
    cancelId: 1,
    message: `${app.name} ${version} is available.`,
    detail: `You are running ${app.getVersion()}. The update downloads in the `
      + 'background; you will be asked before it is installed.',
  });
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
 * prompt; only once they are all gone is it safe to hand over. If the user
 * cancels at one of those prompts we never get that far, and the staged update
 * installs on the next ordinary quit instead (`autoInstallOnAppQuit`).
 *
 * Prepended so it runs before the app's own window-all-closed handler, which
 * quits outright on Windows and Linux.
 */
function restartAndInstall() {
  app.prependOnceListener('window-all-closed', () => {
    setProgress(-1);
    getUpdater().quitAndInstall();
  });
  for (const win of BrowserWindow.getAllWindows()) win.close();
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
 * The check that runs on its own. Deliberately late: at launch the window is
 * still loading, and a dialog landing over a half-drawn editor reads as a
 * crash. Waiting also means a run short enough to be a mistaken double-click
 * never gets interrupted.
 */
function checkOnStartup() {
  if (!app.isPackaged) return;
  setTimeout(() => checkForUpdates({ interactive: false }), 8000).unref();
}

module.exports = { checkForUpdates, checkOnStartup };
