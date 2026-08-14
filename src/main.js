import 'katex/dist/katex.min.css';
import './styles/themes.css';
import './styles/app.css';
import './styles/markdown.css';

import { Editor } from './editor/editor.js';
import { Preview } from './preview/preview.js';
import { PreviewEditor } from './preview/wysiwyg.js';
import { PreviewFind } from './preview/find.js';
import { DEFAULT_THEME, applyTheme, applyAccent, normalizeHex } from './themes.js';
import { exportDocument } from './export.js';
import { TabBar, TAB_MIME } from './tabs.js';
import { Shortcuts, formatAccel } from './shortcuts.js';
import { createSettingsPanel } from './settings-panel.js';
import { createAboutPanel } from './about-panel.js';

const bridge = window.jmd;
const $ = (id) => document.getElementById(id);

const el = {
  panes: $('panes'),
  editorPane: $('editor-pane'),
  previewPane: $('preview-pane'),
  preview: $('preview'),
  find: $('find'),
  findInput: $('find-input'),
  findCount: $('find-count'),
  findPrev: $('find-prev'),
  findNext: $('find-next'),
  findClose: $('find-close'),
  divider: $('divider'),
  tabbar: $('tabbar'),
  tabs: $('tabs'),
  newTabBtn: $('tab-new'),
  docPath: $('doc-path'),
  docPathText: $('doc-path-text'),
  statusLayout: $('status-layout'),
  settingsBtn: $('btn-settings'),
  statusMode: $('status-mode'),
  statusCounts: $('status-counts'),
  statusMsg: $('status-msg'),
};

document.body.dataset.platform = bridge?.platform ?? 'browser';

// ------------------------------------------------------------------ settings

const SETTINGS_KEY = 'jmd.settings';
const settings = {
  theme: DEFAULT_THEME,
  accent: null,
  layout: 'split',
  split: 50,
  wysiwyg: true,
  shortcuts: null,
  ...readSettings(),
};

function readSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) ?? {};
  } catch {
    return {};
  }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable; settings are best-effort */
  }
}

const shortcuts = new Shortcuts(settings.shortcuts);

// -------------------------------------------------------------------- render

const preview = new Preview(el.preview, el.previewPane);

const previewFind = new PreviewFind(
  el.preview,
  el.previewPane,
  {
    bar: el.find,
    input: el.findInput,
    count: el.findCount,
    prev: el.findPrev,
    next: el.findNext,
    close: el.findClose,
  },
  { onClose: () => (previewEditor.enabled ? previewEditor.focus() : editor.focus()) },
);

let renderHandle = 0;
function scheduleRender() {
  cancelAnimationFrame(renderHandle);
  renderHandle = requestAnimationFrame(() => {
    preview.render(editor.getValue());
    preview.syncAtomic();
    // A re-render leaves the find ranges pointing at replaced nodes.
    previewFind.reindex();
  });
}

const editor = new Editor(el.editorPane, {
  onChange: () => {
    scheduleRender();
    refreshChrome();
    refreshCounts();
  },
  onScroll: () => syncScroll('editor'),
});

const previewEditor = new PreviewEditor({
  preview,
  editor,
  onCommit: () => {
    refreshChrome();
    refreshCounts();
    previewFind.reindex();
  },
  onAtomicClick: (line) => {
    // Read-only blocks (math, code, raw HTML) are edited in the source pane.
    setLayout('split');
    editor.goToLine(line);
    editor.focus();
  },
});

// ---------------------------------------------------------------- documents

/**
 * Open documents. Exactly one is `active`: its text lives in the editor view,
 * every other tab keeps a detached EditorState (so undo history, selection and
 * scroll position all survive a switch).
 * @typedef {{ id: number, path: string|null, saved: string,
 *             state: import('@codemirror/state').EditorState, previewScroll: number }} Tab
 */
/** @type {Tab[]} */
const tabs = [];
/** @type {Tab|null} */
let active = null;
let tabSeq = 0;

const tabBar = new TabBar(el.tabs, {
  onSelect: (id) => activateTab(byId(id)),
  onClose: (id) => closeTab(byId(id)),
  onNew: () => newTab(),
  onReorder: (id, beforeId) => reorderTab(id, beforeId),
  onDetach: (id, at) => detachTab(byId(id), at),
});

el.newTabBtn.addEventListener('click', () => newTab());

function byId(id) {
  return tabs.find((tab) => tab.id === id) ?? null;
}

/** Current text of a tab, wherever it happens to live. */
function textOf(tab) {
  return tab === active ? editor.getValue() : tab.state.doc.toString();
}

function nameOf(tab) {
  const name = bridge?.basename?.(tab.path) ?? (tab.path ? tab.path.split(/[\\/]/).pop() : null);
  return name ?? 'Untitled';
}

function isTabDirty(tab) {
  return textOf(tab) !== tab.saved;
}

/** An untouched blank document — the one tab an opened file may take over. */
function isEmptyTab(tab) {
  return !tab.path && !isTabDirty(tab) && !textOf(tab);
}

function isDirty() {
  return active ? isTabDirty(active) : false;
}

function newTab({ path = null, content = '', activate = true } = {}) {
  const tab = {
    id: ++tabSeq,
    path,
    saved: content,
    state: editor.createState(content),
    previewScroll: 0,
    editorScroll: 0,
  };
  tabs.push(tab);
  if (activate) activateTab(tab);
  else renderTabs();
  return tab;
}

/** Stash the live editor/preview position back into the active tab. */
function captureActive() {
  if (!active) return;
  active.state = editor.view.state;
  active.previewScroll = el.previewPane.scrollTop;
}

function activateTab(tab) {
  if (!tab || tab === active) return;
  const wasEditing = previewEditor.enabled;
  // Commits any pending in-preview edit into the outgoing document first.
  if (wasEditing) previewEditor.setEnabled(false);
  captureActive();

  active = tab;
  editor.setState(tab.state);
  preview.setBasePath(tab.path);
  preview.invalidate();
  preview.render(editor.getValue());
  preview.syncAtomic();
  previewFind.reindex();
  el.previewPane.scrollTop = tab.previewScroll;

  if (wasEditing) previewEditor.setEnabled(true);
  renderTabs();
  tabBar.scrollIntoView(tab.id);
  refreshChrome();
  refreshCounts();
  if (previewEditor.enabled) previewEditor.focus();
  else editor.focus();
}

function stepTab(delta) {
  if (tabs.length < 2) return;
  const index = tabs.indexOf(active);
  activateTab(tabs[(index + delta + tabs.length) % tabs.length]);
}

function selectTabIndex(index) {
  if (index >= 0 && index < tabs.length) activateTab(tabs[index]);
}

function reorderTab(id, beforeId) {
  const tab = byId(id);
  if (!tab) return;
  tabs.splice(tabs.indexOf(tab), 1);
  const target = beforeId == null ? tabs.length : tabs.findIndex((t) => t.id === beforeId);
  tabs.splice(target < 0 ? tabs.length : target, 0, tab);
  renderTabs();
}

/**
 * Dropping a tab outside the window moves that document — unsaved text and
 * all — to wherever it was let go: onto another jmd window, which takes it
 * over, or onto nothing, which opens a window of its own. The main process
 * owns that decision, since only it knows where the other windows are.
 */
async function detachTab(tab, at) {
  if (!tab || !bridge?.detachTab) return false;
  const moved = await bridge.detachTab({
    path: tab.path,
    content: textOf(tab),
    saved: tab.saved,
    x: at?.x ?? 0,
    y: at?.y ?? 0,
    // A window's only tab can join another window, but pulling it into a new
    // one would just close this window and open an identical one.
    lone: tabs.length < 2,
  });
  if (!moved) return false;
  flash(`Moved ${nameOf(tab)} to ${moved === 'merged' ? 'another' : 'a new'} window`);
  // The text is safe in the other window, so this copy goes without a prompt.
  removeTab(tab);
  return true;
}

/** Take a document over from a window it was dragged out of. */
function adoptTab({ path, content, saved }) {
  const tab = active && isEmptyTab(active) ? loadDocument(path, content) : newTab({ path, content });
  tab.saved = saved ?? content;
  activateTab(tab);
  refreshChrome();
  refreshCounts();
}

/**
 * Close a tab, asking about unsaved work first. Closing the last tab closes
 * the window, the way every other tabbed macOS app behaves.
 * @returns {Promise<boolean>} whether it actually closed
 */
async function closeTab(tab) {
  if (!tab) return false;
  if (isTabDirty(tab)) {
    activateTab(tab);
    const choice = (await bridge?.confirmClose(nameOf(tab))) ?? 'discard';
    if (choice === 'cancel') return false;
    if (choice === 'save' && !(await save())) return false;
  }
  return removeTab(tab);
}

/** Drop a tab from the strip, with no questions asked about its contents. */
function removeTab(tab) {
  const index = tabs.indexOf(tab);
  if (index < 0) return false;
  tabs.splice(index, 1);
  if (!tabs.length) {
    if (bridge) {
      closing = true;
      bridge.closeWindow();
      return true;
    }
    active = null;
    newTab({ content: '' });
    return true;
  }
  if (active === tab) {
    active = null;
    activateTab(tabs[Math.min(index, tabs.length - 1)]);
  } else {
    renderTabs();
  }
  return true;
}

function renderTabs() {
  syncWatches();
  tabBar.render(
    tabs.map((tab) => ({
      id: tab.id,
      name: nameOf(tab),
      path: tab.path,
      dirty: isTabDirty(tab),
    })),
    active?.id ?? null,
  );
}

// ------------------------------------------------------ following the disk

/** The set of paths the main process is currently watching for us. */
let watching = '';

function syncWatches() {
  const paths = [...new Set(tabs.map((tab) => tab.path).filter(Boolean))].sort();
  const key = paths.join('\n');
  if (key === watching) return;
  watching = key;
  bridge?.watchFiles?.(paths);
}

/**
 * What this window last wrote to each path. A save is a change to the file
 * like any other, and this is what tells the two apart.
 * @type {Map<string, string>}
 */
const lastWritten = new Map();

/**
 * An open file changed underneath us. A tab with no unsaved work follows the
 * file; one with unsaved work keeps it and says so, because there is no
 * version of "reload" that does not throw the user's own text away.
 */
function fileChangedOnDisk(path, content) {
  if (lastWritten.get(path) === content) return; // our own save, coming back
  for (const tab of tabs) {
    if (tab.path !== path) continue;
    if (textOf(tab) === content) {
      tab.saved = content;
      continue;
    }
    if (isTabDirty(tab)) {
      flash(`${nameOf(tab)} changed on disk — your unsaved version is kept`);
      continue;
    }
    reloadTab(tab, content);
    flash(`Reloaded ${nameOf(tab)}`);
  }
  refreshChrome();
}

/** Replace a tab's text with what is now on disk, keeping the reader in place. */
function reloadTab(tab, content) {
  if (tab !== active) {
    tab.state = editor.createState(content);
    tab.saved = content;
    return;
  }
  const line = editor.topLine();
  const wasEditing = previewEditor.enabled;
  if (wasEditing) previewEditor.setEnabled(false);
  editor.setValue(content, { silent: true });
  tab.saved = content;
  preview.invalidate();
  preview.render(content);
  preview.syncAtomic();
  previewFind.reindex();
  editor.scrollToLine(line);
  preview.scrollToLine(line);
  if (wasEditing) previewEditor.setEnabled(true);
  refreshCounts();
}

/**
 * Show a file: focus the tab that already holds it, take over an untouched
 * blank tab, or open a new one.
 */
function openInTab(path, content) {
  const existing = path ? tabs.find((tab) => tab.path === path) : null;
  if (existing) {
    activateTab(existing);
    if (!isTabDirty(existing)) loadDocument(path, content);
    return existing;
  }
  if (active && isEmptyTab(active)) {
    loadDocument(path, content);
    return active;
  }
  return newTab({ path, content });
}

/** Replace the active tab's document. */
function loadDocument(path, content) {
  if (!active) return newTab({ path, content });
  const wasEditing = previewEditor.enabled;
  if (wasEditing) previewEditor.setEnabled(false);
  active.path = path;
  active.saved = content;
  active.previewScroll = 0;
  editor.setState(editor.createState(content));
  preview.setBasePath(path);
  preview.invalidate();
  preview.render(content);
  preview.syncAtomic();
  previewFind.reindex();
  el.previewPane.scrollTop = 0;
  if (wasEditing) previewEditor.setEnabled(true);
  renderTabs();
  refreshChrome();
  refreshCounts();
  return active;
}

/** Open native files dropped anywhere on the window, one document per tab. */
async function openDroppedPaths(paths) {
  const supported = paths.filter((path) => /\.(?:md|markdown|mdown|mkd|txt)$/i.test(path));
  if (!supported.length) {
    flash('Drop a Markdown or text file to open it.');
    return 0;
  }
  let opened = 0;
  for (const path of supported) {
    try {
      const file = await bridge.readFile(path);
      openInTab(file.path, file.content);
      opened++;
    } catch (error) {
      console.error(`Could not open dropped file: ${path}`, error);
      flash(`Could not open ${bridge?.basename?.(path) ?? 'file'}.`);
    }
  }
  return opened;
}

// A tab dragged out of another jmd window can be let go anywhere over this one,
// and the move is answered through the main process. The drop itself must do
// nothing here: left alone, the editable preview would take the drag's text and
// write the tab's id into the document.
window.addEventListener(
  'drop',
  (event) => {
    if (tabBar.draggingId != null) return; // a drag from our own strip
    if (!event.dataTransfer?.types.includes(TAB_MIME)) return;
    event.preventDefault();
    event.stopPropagation();
  },
  true,
);

let fileDragDepth = 0;
window.addEventListener('dragenter', (event) => {
  if (!event.dataTransfer?.types.includes('Files')) return;
  event.preventDefault();
  fileDragDepth++;
  document.body.classList.add('is-file-dragging');
}, true);
window.addEventListener('dragover', (event) => {
  if (!event.dataTransfer?.types.includes('Files')) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
}, true);
window.addEventListener('dragleave', (event) => {
  if (!event.dataTransfer?.types.includes('Files')) return;
  fileDragDepth = Math.max(0, fileDragDepth - 1);
  if (!fileDragDepth) document.body.classList.remove('is-file-dragging');
}, true);
window.addEventListener('drop', (event) => {
  if (!event.dataTransfer?.files.length) return;
  event.preventDefault();
  fileDragDepth = 0;
  document.body.classList.remove('is-file-dragging');
  event.stopPropagation();
  const paths = Array.from(event.dataTransfer.files, (file) => bridge?.droppedFilePath?.(file)).filter(Boolean);
  openDroppedPaths(paths);
}, true);

// ------------------------------------------------------------------- chrome

function refreshChrome() {
  const label = active ? nameOf(active) : 'Untitled';
  const dirty = isDirty();
  renderTabs();
  refreshPath();
  bridge?.setTitle(`${dirty ? '● ' : ''}${label} — jmd`);
  bridge?.setEdited(dirty);
  bridge?.setRepresentedFile(active?.path ?? '');
}

/** The absolute path, sitting quietly in the status bar. */
function refreshPath() {
  const path = active?.path ?? null;
  el.docPath.hidden = !path;
  if (!path) return;
  // Keep the actual absolute path in the document. CSS may ellipsize it when
  // the window is narrow, while the title always exposes the complete value.
  el.docPathText.textContent = path;
  el.docPath.title = `${path}\n${revealLabel()}`;
}

function revealLabel() {
  const where = bridge?.platform === 'darwin' ? 'Finder' : bridge?.platform === 'win32' ? 'Explorer' : 'file manager';
  const accel = shortcuts.primary('file.reveal');
  return `Reveal in ${where}${accel ? ` (${formatAccel(accel)})` : ''}`;
}

function revealActive() {
  if (!active?.path) {
    flash('Save the document first to reveal it.');
    return;
  }
  bridge?.showInFolder(active.path);
}

el.docPath.addEventListener('click', () => revealActive());

let statusTimer = null;
function flash(message) {
  el.statusMsg.textContent = message;
  el.statusMsg.style.opacity = '1';
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    el.statusMsg.style.opacity = '0';
  }, 2200);
}

function refreshCounts() {
  const { words, chars, lines } = editor.stats();
  el.statusCounts.textContent = `${words} words · ${chars} chars · ${lines} lines`;
}

// --------------------------------------------------------------- scroll sync

/**
 * Which pane the user last drove; the other one follows. Deliberately keyed to
 * real interaction rather than hover — otherwise leaving the pointer over the
 * preview would stop it from following what you type in the editor.
 */
let scrollLeader = 'editor';
let syncingUntil = 0;

for (const [pane, name] of [[el.editorPane, 'editor'], [el.previewPane, 'preview']]) {
  const claim = () => {
    scrollLeader = name;
  };
  for (const type of ['wheel', 'keydown', 'mousedown', 'touchstart', 'focusin']) {
    pane.addEventListener(type, claim, { passive: true, capture: true });
  }
}

el.previewPane.addEventListener('scroll', () => syncScroll('preview'), { passive: true });

function syncScroll(source) {
  if (settings.layout !== 'split') return;
  if (source !== scrollLeader) return;
  if (performance.now() < syncingUntil) return;
  syncingUntil = performance.now() + 60;
  if (source === 'editor') preview.scrollToLine(editor.topLine());
  else editor.scrollToLine(preview.topLine());
}

// -------------------------------------------------------------------- layout

function setLayout(layout) {
  settings.layout = layout;
  el.panes.className = `layout-${layout}`;
  el.statusLayout.textContent = ({ editor: 'Editor', split: 'Split', preview: 'Preview' })[layout];
  el.statusLayout.dataset.layout = layout;
  // The preview must be visible for in-preview editing to make sense; with the
  // preview alone on screen, editing it is the only thing the pane is good for.
  if (layout === 'editor') previewFind.hide();
  if (layout === 'editor' && previewEditor.enabled) setWysiwyg(false);
  if (layout === 'preview' && !previewEditor.enabled) setWysiwyg(true);
  saveSettings();
  requestAnimationFrame(() => editor.view.requestMeasure());
}

function setSplit(percent) {
  const clamped = Math.min(80, Math.max(20, percent));
  settings.split = clamped;
  el.panes.style.setProperty('--split', `${clamped}%`);
  saveSettings();
}

function setWysiwyg(enabled) {
  if (enabled && settings.layout === 'editor') setLayout('split');
  previewEditor.setEnabled(enabled);
  settings.wysiwyg = enabled;
  el.statusMode.textContent = enabled ? 'Preview editing' : 'Source';
  saveSettings();
  if (enabled) el.preview.focus();
}

// Divider drag
{
  let dragging = false;
  const onMove = (event) => {
    if (!dragging) return;
    const rect = el.panes.getBoundingClientRect();
    setSplit(((event.clientX - rect.left) / rect.width) * 100);
  };
  el.divider.addEventListener('mousedown', (event) => {
    dragging = true;
    event.preventDefault();
    document.body.style.cursor = 'col-resize';
  });
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor = '';
    editor.view.requestMeasure();
  });
  el.divider.addEventListener('dblclick', () => setSplit(50));
  el.divider.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') setSplit(settings.split - 2);
    if (event.key === 'ArrowRight') setSplit(settings.split + 2);
  });
}

// ----------------------------------------------------------------- skin

function setTheme(id) {
  settings.theme = applyTheme(id);
  saveSettings();
  settingsPanel?.syncAppearance();
}

function setAccent(color) {
  settings.accent = applyAccent(normalizeHex(color));
  saveSettings();
  settingsPanel?.syncAppearance();
}

// ------------------------------------------------------------------ finding

/**
 * ⌘F searches whichever pane the user is working in: the rendered document
 * when the preview has focus (or is all there is on screen), the source
 * otherwise.
 */
function openFind() {
  const previewIsWhereTheUserIs =
    settings.layout === 'preview' ||
    (settings.layout === 'split' && el.previewPane.contains(document.activeElement));
  if (previewIsWhereTheUserIs) previewFind.show();
  else editor.openSearch();
}

/** Search the rendered document explicitly, whichever pane has focus. */
function findInPreview() {
  if (settings.layout === 'editor') setLayout('split');
  previewFind.show();
}

// ---------------------------------------------------------- preview affordances

// Links open in the real browser rather than navigating the app.
el.preview.addEventListener('click', (event) => {
  const anchor = event.target.closest?.('a[href]');
  if (!anchor) return;
  const href = anchor.getAttribute('href');
  if (href?.startsWith('#')) return; // let in-document anchors work
  event.preventDefault();
  if (/^https?:/i.test(href)) bridge?.openExternal(href);
});

// Toggling a task checkbox rewrites the source line.
el.preview.addEventListener('change', (event) => {
  const box = event.target;
  if (!box.classList?.contains('task-checkbox')) return;
  const line = Number(box.dataset.line);
  if (!Number.isFinite(line) || line < 0) return;
  const text = editor.getLines(line, line + 1);
  const updated = box.checked
    ? text.replace(/^(\s*(?:[-*+]|\d+[.)])\s+)\[ \]/, '$1[x]')
    : text.replace(/^(\s*(?:[-*+]|\d+[.)])\s+)\[[xX]\]/, '$1[ ]');
  if (updated === text) return;
  editor.replaceLines(line, line + 1, updated, { silent: false });
});

// Clicking preview text in source mode jumps the editor caret to that block.
el.preview.addEventListener('dblclick', (event) => {
  if (previewEditor.enabled) return;
  let node = event.target;
  while (node && node !== el.preview && !node.hasAttribute?.('data-line')) node = node.parentElement;
  const line = Number(node?.getAttribute?.('data-line'));
  if (!Number.isFinite(line)) return;
  editor.goToLine(line);
  editor.focus();
});

// ---------------------------------------------------------------- file access

async function save({ as = false } = {}) {
  if (!active) return false;
  previewEditor.commit({ rerender: true });
  const content = editor.getValue();
  const result = as
    ? await bridge?.saveAs({ path: active.path, content })
    : await bridge?.save({ path: active.path, content });
  if (!result) return false;
  active.path = result.path;
  active.saved = content;
  lastWritten.set(result.path, content);
  preview.setBasePath(result.path);
  refreshChrome();
  flash(`Saved ${bridge?.basename?.(result.path) ?? ''}`);
  return true;
}

function buildExportHtml() {
  previewEditor.commit({ rerender: true });
  return exportDocument({
    title: (bridge?.basename?.(active?.path) ?? 'Untitled').replace(/\.[^.]+$/, ''),
    bodyHtml: el.preview.innerHTML,
    theme: settings.theme,
  });
}

async function exportHtml() {
  const html = buildExportHtml();
  const result = await bridge?.exportHtml({ path: active?.path, html });
  if (result) flash(`Exported ${bridge?.basename?.(result.path) ?? ''}`);
}

// ----------------------------------------------------------------- settings UI

const settingsPanel = createSettingsPanel({
  shortcuts,
  settings,
  onTheme: (id) => setTheme(id),
  onAccent: (color) => setAccent(color),
  onLayout: (layout) => setLayout(layout),
  onShortcuts: () => {
    settings.shortcuts = shortcuts.toJSON();
    saveSettings();
    publishShortcuts();
  },
});

el.settingsBtn.addEventListener('click', () => settingsPanel.toggle());

const aboutPanel = createAboutPanel({
  openExternal: (url) => bridge?.openExternal(url),
  versions: bridge?.versions,
});

// ------------------------------------------------------------------ actions

/** Everything a shortcut or a menu item can trigger, by action id. */
const ACTIONS = {
  'tab.new': () => newTab(),
  'tab.close': () => closeTab(active),
  'tab.next': () => stepTab(1),
  'tab.prev': () => stepTab(-1),
  'tab.last': () => selectTabIndex(tabs.length - 1),
  'layout.editor': () => setLayout('editor'),
  'layout.split': () => setLayout('split'),
  'layout.preview': () => setLayout('preview'),
  'view.wysiwyg': () => setWysiwyg(!previewEditor.enabled),
  'find.preview': () => findInPreview(),
  'file.reveal': () => revealActive(),
  'app.settings': () => settingsPanel.toggle(),
  'app.about': () => aboutPanel.toggle(),
};
for (let i = 1; i <= 8; i++) ACTIONS[`tab.${i}`] = () => selectTabIndex(i - 1);

// The menu and the keyboard can both deliver the same action (on Windows and
// Linux a menu accelerator really is registered); ignore the echo.
let lastRun = { id: null, at: -1e9 };

function runAction(id) {
  const handler = ACTIONS[id];
  if (!handler) return false;
  const now = performance.now();
  if (lastRun.id === id && now - lastRun.at < 80) return true;
  lastRun = { id, at: now };
  handler();
  return true;
}

// Capture phase: shortcuts win over CodeMirror's own keymap.
window.addEventListener(
  'keydown',
  (event) => {
    if ((settingsPanel.isOpen || aboutPanel.isOpen) && event.key === 'Escape') return;
    const id = shortcuts.match(event);
    if (!id || !ACTIONS[id]) return;
    event.preventDefault();
    event.stopPropagation();
    runAction(id);
  },
  true,
);

/** Push the current bindings to the menu and to the buttons' tooltips. */
function publishShortcuts() {
  bridge?.setMenuAccelerators?.(shortcuts.menuAccelerators());
  const hint = (id) => {
    const accel = shortcuts.primary(id);
    return accel ? ` (${formatAccel(accel)})` : '';
  };
  el.settingsBtn.title = `Settings${hint('app.settings')}`;
  el.newTabBtn.title = `New tab${hint('tab.new')}`;
  refreshPath();
}

// ------------------------------------------------------------------ menu wiring

bridge?.onFileOpened(({ path, content }) => openInTab(path, content));
bridge?.onTabAdopt?.((payload) => adoptTab(payload));
bridge?.onFileChanged?.(({ path, content }) => fileChangedOnDisk(path, content));
bridge?.onMenuSave(() => save());
bridge?.onMenuSaveAs(() => save({ as: true }));
bridge?.onMenuExportHtml(() => exportHtml());
bridge?.onMenuFind(() => openFind());
bridge?.onMenuTheme((theme) => setTheme(theme));
bridge?.onMenuAction?.((id) => runAction(id));

// ------------------------------------------------------------- close handling

let closing = false;
window.addEventListener('beforeunload', (event) => {
  if (closing || !tabs.some(isTabDirty)) return;
  event.preventDefault();
  event.returnValue = '';
  confirmThenClose();
});

async function confirmThenClose() {
  for (const tab of [...tabs]) {
    if (!isTabDirty(tab)) continue;
    activateTab(tab);
    const choice = await bridge?.confirmClose(nameOf(tab));
    if (choice === 'cancel') return;
    if (choice === 'save' && !(await save())) return;
    tab.saved = textOf(tab); // answered for; don't ask again on the way out
  }
  closing = true;
  bridge?.closeWindow();
}

// ------------------------------------------------------------------ debug hooks

// Surfaced for the smoke harness in test/smoke.cjs, and handy in devtools.
window.__jmdErrors = [];
window.addEventListener('error', (event) => window.__jmdErrors.push(String(event.message)));
window.addEventListener('unhandledrejection', (event) => window.__jmdErrors.push(String(event.reason)));
window.__jmd = {
  editor,
  preview,
  previewEditor,
  previewFind,
  openFind,
  setWysiwyg,
  setLayout,
  setTheme,
  setAccent,
  loadDocument,
  fileChangedOnDisk,
  openInTab,
  openDroppedPaths,
  newTab,
  closeTab,
  detachTab,
  adoptTab,
  activateTab,
  syncScroll,
  save,
  exportHtml,
  buildExportHtml,
  settings,
  shortcuts,
  settingsPanel,
  aboutPanel,
  runAction,
  tabs,
  get activeTab() {
    return active;
  },
};

// ----------------------------------------------------------------- boot

setTheme(settings.theme);
setAccent(settings.accent);
setSplit(settings.split);
setLayout(['editor', 'split', 'preview'].includes(settings.layout) ? settings.layout : 'split');
publishShortcuts();

(async () => {
  const initial = new URLSearchParams(location.search).get('file');
  if (initial && bridge) {
    try {
      const { path, content } = await bridge.readFile(initial);
      newTab({ path, content });
    } catch (error) {
      newTab({ content: `# Could not open file\n\n\`\`\`\n${String(error)}\n\`\`\`\n` });
    }
  } else {
    newTab({ content: '' });
  }
  if (settings.wysiwyg) setWysiwyg(true);
  else el.statusMode.textContent = 'Source';
  if (settings.wysiwyg) {
    previewEditor.focus();
    // Electron may activate the BrowserWindow just after renderer startup,
    // moving focus back to the web contents itself. Reassert the intended
    // empty-document caret once the first frame has been presented.
    requestAnimationFrame(() => previewEditor.focus());
  } else editor.focus();
})();
