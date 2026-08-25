const { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, screen, shell, nativeTheme } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const { pathToFileURL } = require('node:url');
const { checkForUpdates, checkOnStartup, cancelPendingInstall } = require('./updater');

const isMac = process.platform === 'darwin';
const devServer = process.env.JMD_DEV_SERVER;

// A packaged app takes its icon from the bundle; running from source there is
// no bundle, so point at the same master electron-builder uses.
const devIcon = app.isPackaged ? null : path.join(__dirname, '..', 'build', 'icon.png');

// Local images referenced from a document are served through this scheme so
// they load identically whether the page came from the dev server or from disk.
protocol.registerSchemesAsPrivileged([
  { scheme: 'jmd-file', privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true } },
]);

function registerFileProtocol() {
  protocol.handle('jmd-file', (request) => {
    // jmd-file://local/<absolute path, percent-encoded>
    const url = new URL(request.url);
    let filePath = decodeURIComponent(url.pathname);
    // Windows paths arrive as /C:/… — drop the leading slash before resolving.
    if (process.platform === 'win32' && /^\/[a-zA-Z]:/.test(filePath)) filePath = filePath.slice(1);
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

/** @type {Set<BrowserWindow>} */
const windows = new Set();

/**
 * When each window was last brought forward. There is no z-order to ask for,
 * and overlapping windows have to be told apart when a tab is dropped over
 * them; the one the user last worked in is the one that was on top.
 * @type {Map<BrowserWindow, number>}
 */
const raisedAt = new Map();

function createWindow(filePath = null) {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 600,
    minHeight: 400,
    show: false,
    title: 'jmd',
    ...(devIcon ? { icon: devIcon } : {}),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1a1a1a' : '#ffffff',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 14, y: 14 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });

  windows.add(win);
  raisedAt.set(win, Date.now());
  win.on('focus', () => raisedAt.set(win, Date.now()));
  win.on('closed', () => {
    windows.delete(win);
    raisedAt.delete(win);
  });
  win.once('ready-to-show', () => win.show());

  // Pass the file to open (if any) through the query string so the renderer
  // can load it as soon as it boots.
  const query = filePath ? { file: filePath } : undefined;
  if (devServer) {
    const url = new URL(devServer);
    if (filePath) url.searchParams.set('file', filePath);
    win.loadURL(url.toString());
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query });
  }

  // Never navigate away in-app; open external links in the real browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    const current = win.webContents.getURL();
    if (url !== current) {
      event.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    }
  });

  return win;
}

/** Ask the focused renderer to run a menu action. */
function send(channel, ...args) {
  const win = BrowserWindow.getFocusedWindow() || [...windows][0];
  if (win) win.webContents.send(channel, ...args);
}

/**
 * Accelerators the renderer told us about, keyed by action id. They are shown
 * in the menu but (on macOS) deliberately not registered: the renderer owns
 * dispatch so the user can rebind them at runtime.
 * @type {Record<string, string>}
 */
let accelerators = {};

/** A menu item that fires a configurable action in the renderer. */
function actionItem(label, id, extra = {}) {
  return {
    label,
    ...(accelerators[id] ? { accelerator: accelerators[id] } : {}),
    registerAccelerator: false,
    click: () => send('menu:action', id),
    ...extra,
  };
}

/** The same links the renderer's About dialog offers. */
const LINKS = {
  repo: 'https://github.com/jojonki/jmd',
  sponsor: 'https://github.com/sponsors/jojonki',
};

/** Sits next to About: the app menu on macOS, the Help menu everywhere else. */
const UPDATE_ITEM = {
  label: 'Check for Updates…',
  click: () => checkForUpdates({ interactive: true }),
};

function buildMenu() {
  // The same list, in the same order, as `THEMES` in src/themes.js.
  const themes = [
    ['github', 'GitHub Light'],
    ['paper', 'Paper'],
    ['solarized-light', 'Solarized Light'],
    ['catppuccin-latte', 'Catppuccin Latte'],
    ['sakura', 'Sakura'],
    ['nord', 'Nord'],
    ['dracula', 'Dracula'],
    ['gruvbox-dark', 'Gruvbox Dark'],
    ['tokyo-night', 'Tokyo Night'],
    ['rose-pine', 'Rosé Pine'],
    ['midnight', 'Midnight'],
    ['synthwave', 'Synthwave'],
  ];

  /** @type {Electron.MenuItemConstructorOptions[]} */
  const template = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            actionItem(`About ${app.name}`, 'app.about'),
            UPDATE_ITEM,
            { type: 'separator' },
            actionItem('Settings…', 'app.settings'),
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        }]
      : []),
    {
      label: 'File',
      submenu: [
        actionItem('New Tab', 'tab.new'),
        { label: 'New Window', accelerator: 'CmdOrCtrl+N', click: () => createWindow() },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => openFileDialog() },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => send('menu:save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('menu:save-as') },
        { type: 'separator' },
        { label: 'Export HTML…', click: () => send('menu:export-html') },
        actionItem(isMac ? 'Reveal in Finder' : 'Show in File Manager', 'file.reveal'),
        { type: 'separator' },
        actionItem('Close Tab', 'tab.close'),
        isMac
          ? { role: 'close', label: 'Close Window', accelerator: 'Cmd+Shift+W' }
          : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Find', accelerator: 'CmdOrCtrl+F', click: () => send('menu:find') },
        actionItem('Find in Preview', 'find.preview'),
      ],
    },
    {
      label: 'View',
      submenu: [
        actionItem('Editor Only', 'layout.editor'),
        actionItem('Editor + Preview', 'layout.split'),
        actionItem('Preview Only', 'layout.preview'),
        { type: 'separator' },
        actionItem('Wide Width', 'view.wide'),
        actionItem('Edit In Preview', 'view.wysiwyg'),
        actionItem('Vim Mode', 'editor.vim'),
        { type: 'separator' },
        {
          label: 'Theme',
          submenu: themes.map(([id, label]) => ({
            label,
            click: () => send('menu:theme', id),
          })),
        },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      role: 'window',
      submenu: [
        actionItem('Next Tab', 'tab.next'),
        actionItem('Previous Tab', 'tab.prev'),
        { type: 'separator' },
        ...(isMac
          ? [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
          : [{ role: 'minimize' }, { role: 'close' }]),
      ],
    },
    {
      role: 'help',
      submenu: [
        ...(isMac ? [] : [actionItem(`About ${app.name}`, 'app.about'), UPDATE_ITEM, { type: 'separator' }]),
        { label: 'jmd on GitHub', click: () => shell.openExternal(LINKS.repo) },
        { label: 'Sponsor jmd', click: () => shell.openExternal(LINKS.sponsor) },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const MD_FILTERS = [
  { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt'] },
  { name: 'All Files', extensions: ['*'] },
];

async function openFileDialog() {
  const win = BrowserWindow.getFocusedWindow();
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: MD_FILTERS,
  });
  if (canceled || !filePaths.length) return;
  openPath(filePaths[0]);
}

async function openPath(filePath) {
  const win = BrowserWindow.getFocusedWindow() || [...windows][0];
  if (!win) {
    createWindow(filePath);
    return;
  }
  // A window holds tabs now, so an opened file joins the focused one; the
  // renderer decides whether that means a new tab or an existing one.
  const content = await fs.readFile(filePath, 'utf8');
  win.webContents.send('file:opened', { path: filePath, content });
  win.focus();
}

// ------------------------------------------------------------ file watching

/**
 * One watcher per open file, per window. The renderer says which paths it has
 * open; whenever one of them changes on disk we read it and hand the fresh
 * text over, and the renderer decides whether that means reloading a tab.
 * @type {Map<Electron.WebContents, Map<string, { close: () => void }>>}
 */
const watched = new Map();

function watchFile(wc, filePath) {
  let watcher = null;
  let timer = null;

  const arm = () => {
    try {
      // Not persistent: watching a document must not by itself keep the
      // process alive after its window is gone.
      watcher = fsSync.watch(filePath, { persistent: false }, () => schedule());
      watcher.on('error', () => schedule());
    } catch {
      watcher = null; // the file is not there right now; nothing to follow
    }
  };

  // A rename lands as one event and a write as several; wait for the flurry
  // to settle before reading, or the read catches a half-written file.
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(reload, 120);
  };

  const reload = async () => {
    // Most editors save by writing a new file over the old name, which leaves
    // the watch pointing at an inode nothing refers to any more. Re-arming on
    // every event is what keeps the second external save visible.
    try {
      watcher?.close();
    } catch {
      /* already closed */
    }
    arm();
    try {
      const content = await fs.readFile(filePath, 'utf8');
      if (!wc.isDestroyed()) wc.send('file:changed', { path: filePath, content });
    } catch {
      /* deleted, or briefly absent mid-save: there is nothing to report */
    }
  };

  arm();
  return {
    close() {
      clearTimeout(timer);
      try {
        watcher?.close();
      } catch {
        /* already closed */
      }
    },
  };
}

ipcMain.on('files:watch', (event, paths) => {
  const wc = event.sender;
  let byPath = watched.get(wc);
  if (!byPath) {
    byPath = new Map();
    watched.set(wc, byPath);
    wc.once('destroyed', () => {
      for (const entry of byPath.values()) entry.close();
      watched.delete(wc);
    });
  }
  const wanted = new Set((Array.isArray(paths) ? paths : []).filter((p) => typeof p === 'string' && p));
  for (const [filePath, entry] of byPath) {
    if (wanted.has(filePath)) continue;
    entry.close();
    byPath.delete(filePath);
  }
  for (const filePath of wanted) {
    if (!byPath.has(filePath)) byPath.set(filePath, watchFile(wc, filePath));
  }
});

// ---------------------------------------------------------------- IPC

ipcMain.handle('file:read', async (_e, filePath) => {
  const content = await fs.readFile(filePath, 'utf8');
  return { path: filePath, content };
});

ipcMain.handle('file:save', async (event, { path: filePath, content }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  let target = filePath;
  if (!target) {
    const { canceled, filePath: chosen } = await dialog.showSaveDialog(win, {
      defaultPath: 'untitled.md',
      filters: MD_FILTERS,
    });
    if (canceled || !chosen) return null;
    target = chosen;
  }
  await fs.writeFile(target, content, 'utf8');
  return { path: target };
});

ipcMain.handle('file:save-as', async (event, { path: filePath, content }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePath: chosen } = await dialog.showSaveDialog(win, {
    defaultPath: filePath || 'untitled.md',
    filters: MD_FILTERS,
  });
  if (canceled || !chosen) return null;
  await fs.writeFile(chosen, content, 'utf8');
  return { path: chosen };
});

ipcMain.handle('file:export-html', async (event, { path: filePath, html }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const base = filePath ? filePath.replace(/\.[^.]+$/, '') : 'untitled';
  const { canceled, filePath: chosen } = await dialog.showSaveDialog(win, {
    defaultPath: `${base}.html`,
    filters: [{ name: 'HTML', extensions: ['html'] }],
  });
  if (canceled || !chosen) return null;
  await fs.writeFile(chosen, html, 'utf8');
  return { path: chosen };
});

ipcMain.handle('dialog:confirm-close', async (event, name) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Save', "Don't Save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    message: `Do you want to save the changes made to "${name}"?`,
    detail: "Your changes will be lost if you don't save them.",
  });
  const choice = ['save', 'discard', 'cancel'][response];
  // Cancelling here is also how a restart-to-update is called off: the windows
  // it was closing stay open, so the pending install has to stand down.
  if (choice === 'cancel') cancelPendingInstall();
  return choice;
});

/**
 * A tab dropped outside its window goes wherever it was let go: into another
 * jmd window that happens to be under the pointer, or into a new window opened
 * on the spot. The text travels through this call rather than being re-read
 * from disk, so unsaved work — and an untitled document — survives the move.
 *
 * @returns {'merged'|'detached'|false} false when the move did not happen
 */
ipcMain.handle('tab:detach', (event, { path: filePath, content, saved, x, y, lone }) => {
  const source = BrowserWindow.fromWebContents(event.sender);
  const document = { path: filePath ?? null, content, saved };

  const target = windowAt(x, y, source);
  if (target) {
    target.webContents.send('tab:adopt', document);
    target.focus();
    return 'merged';
  }

  // Pulling a window's only tab into a new window would close one window and
  // open an identical one; dropping it on another window is still a real move.
  if (lone) return false;

  const win = createWindow();
  win.webContents.once('did-finish-load', () => win.webContents.send('tab:adopt', document));
  placeAt(win, x, y);
  return 'detached';
});

/** The jmd window under a screen point, if the drop landed on one. */
function windowAt(x, y, exclude) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || (!x && !y)) return null;
  const under = [...windows].filter((win) => {
    if (win === exclude || win.isDestroyed() || win.isMinimized() || !win.isVisible()) return false;
    const { x: left, y: top, width, height } = win.getBounds();
    return x >= left && x < left + width && y >= top && y < top + height;
  });
  return under.sort((a, b) => (raisedAt.get(b) ?? 0) - (raisedAt.get(a) ?? 0))[0] ?? null;
}

/** Put a new window under the pointer, without pushing it off the display. */
function placeAt(win, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || (!x && !y)) return;
  const area = screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) }).workArea;
  const [width, height] = win.getSize();
  const left = Math.min(Math.max(Math.round(x) - 80, area.x), area.x + area.width - width);
  const top = Math.min(Math.max(Math.round(y) - 16, area.y), area.y + area.height - height);
  win.setPosition(left, top);
}

ipcMain.on('window:set-title', (event, title) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.setTitle(title);
});

ipcMain.on('window:set-edited', (event, edited) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && isMac) win.setDocumentEdited(edited);
});

ipcMain.on('window:set-represented-file', (event, filePath) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && isMac) win.setRepresentedFilename(filePath || '');
});

ipcMain.on('window:close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.destroy();
});

ipcMain.handle('shell:open-external', async (_e, url) => {
  if (/^https?:/.test(url)) await shell.openExternal(url);
});

ipcMain.handle('shell:show-item', (_e, filePath) => {
  if (typeof filePath === 'string' && filePath) shell.showItemInFolder(filePath);
});

// The renderer owns the key bindings; the menu just mirrors them.
ipcMain.on('menu:accelerators', (_e, map) => {
  if (!map || typeof map !== 'object') return;
  const next = JSON.stringify(map);
  if (next === JSON.stringify(accelerators)) return;
  accelerators = map;
  buildMenu();
});

// ---------------------------------------------------------------- lifecycle

// macOS "Open with" / dock drop
const pendingFiles = [];
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (app.isReady()) openPath(filePath);
  else pendingFiles.push(filePath);
});

app.whenReady().then(() => {
  registerFileProtocol();
  buildMenu();
  if (isMac && devIcon) app.dock.setIcon(devIcon);
  const cliFile = process.argv.slice(devServer ? 2 : 1).find((a) => /\.(md|markdown|mdown|mkd|txt)$/i.test(a));
  let first;
  if (pendingFiles.length) {
    // One window, one tab per file.
    first = createWindow(pendingFiles[0]);
    const rest = pendingFiles.slice(1);
    if (rest.length) {
      first.webContents.once('did-finish-load', () => rest.forEach((f) => openPath(f)));
    }
  } else {
    first = createWindow(cliFile || null);
  }

  // Development affordance: run a script against the freshly created window
  // (used by `npm run smoke` to drive the UI and capture screenshots).
  if (process.env.JMD_SMOKE) {
    require(path.resolve(process.env.JMD_SMOKE))(first, { app });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  checkOnStartup();
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
