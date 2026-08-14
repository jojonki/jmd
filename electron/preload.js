const { contextBridge, ipcRenderer, webUtils } = require('electron');

/**
 * Runs in a sandboxed preload, so Node's `path` is unavailable — the few path
 * operations the renderer needs are implemented here over plain strings and
 * accept either separator, which also makes them behave the same on Windows.
 */
const splitPath = (value) => value.split(/[\\/]/);

function basename(filePath) {
  if (!filePath) return null;
  const parts = splitPath(filePath).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
}

function isAbsolute(value) {
  return value.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(value);
}

/** Resolve `relative` against `baseFile`'s folder into normalized segments. */
function resolveSegments(baseFile, relative) {
  const parts = isAbsolute(relative)
    ? splitPath(relative)
    : [...splitPath(baseFile).slice(0, -1), ...splitPath(relative)];

  const out = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out;
}

/** Channels the main process is allowed to push to the renderer. */
const listen = (channel) => (handler) => {
  const wrapped = (_event, ...args) => handler(...args);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.off(channel, wrapped);
};

contextBridge.exposeInMainWorld('jmd', {
  platform: process.platform,
  readFile: (filePath) => ipcRenderer.invoke('file:read', filePath),
  /** Safely recover a native path while the value is still a real File. */
  droppedFilePath: (file) => webUtils.getPathForFile(file),
  save: (payload) => ipcRenderer.invoke('file:save', payload),
  saveAs: (payload) => ipcRenderer.invoke('file:save-as', payload),
  exportHtml: (payload) => ipcRenderer.invoke('file:export-html', payload),
  confirmClose: (name) => ipcRenderer.invoke('dialog:confirm-close', name),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  /** Reveal a file in Finder / Explorer / the desktop's file manager. */
  showInFolder: (filePath) => ipcRenderer.invoke('shell:show-item', filePath),

  /**
   * Hand the menu the user's current key bindings. The menu only *displays*
   * them on macOS — the renderer is what actually dispatches (see
   * `src/shortcuts.js`), so a rebind takes effect without a restart.
   */
  setMenuAccelerators: (map) => ipcRenderer.send('menu:accelerators', map),

  setTitle: (title) => ipcRenderer.send('window:set-title', title),
  setEdited: (edited) => ipcRenderer.send('window:set-edited', edited),
  setRepresentedFile: (filePath) => ipcRenderer.send('window:set-represented-file', filePath),
  closeWindow: () => ipcRenderer.send('window:close'),

  // Turn `![](./img/foo.png)` into a URL the preview can actually load. The
  // custom scheme works under both the dev server and the packaged file:// page.
  resolveAsset: (baseFile, relative) => {
    if (!relative) return null;
    if (!baseFile && !isAbsolute(relative)) return null;
    const segments = resolveSegments(baseFile ?? '', relative);
    if (!segments.length) return null;
    return `jmd-file://local/${segments.map(encodeURIComponent).join('/')}`;
  },
  basename,

  onFileOpened: listen('file:opened'),
  onMenuSave: listen('menu:save'),
  onMenuSaveAs: listen('menu:save-as'),
  onMenuExportHtml: listen('menu:export-html'),
  onMenuFind: listen('menu:find'),
  onMenuTheme: listen('menu:theme'),
  /** Menu items that map onto a configurable action id. */
  onMenuAction: listen('menu:action'),
});
