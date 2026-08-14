const { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, shell, nativeTheme } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');

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
  win.on('closed', () => windows.delete(win));
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

function buildMenu() {
  const themes = [
    ['github', 'GitHub Light'],
    ['paper', 'Paper'],
    ['nord', 'Nord'],
    ['dracula', 'Dracula'],
    ['solarized-light', 'Solarized Light'],
    ['gruvbox-dark', 'Gruvbox Dark'],
  ];

  /** @type {Electron.MenuItemConstructorOptions[]} */
  const template = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' },
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
      ],
    },
    {
      label: 'View',
      submenu: [
        actionItem('Editor Only', 'layout.editor'),
        actionItem('Editor + Preview', 'layout.split'),
        actionItem('Preview Only', 'layout.preview'),
        { type: 'separator' },
        actionItem('Edit In Preview', 'view.wysiwyg'),
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
  return ['save', 'discard', 'cancel'][response];
});

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
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
