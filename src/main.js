import 'katex/dist/katex.min.css';
import './styles/themes.css';
import './styles/app.css';
import './styles/markdown.css';

import { Editor } from './editor/editor.js';
import { Preview } from './preview/preview.js';
import { PreviewEditor } from './preview/wysiwyg.js';
import { THEMES, DEFAULT_THEME, applyTheme } from './themes.js';
import { WELCOME } from './welcome.js';
import { exportDocument } from './export.js';

const bridge = window.jmd;
const $ = (id) => document.getElementById(id);

const el = {
  panes: $('panes'),
  editorPane: $('editor-pane'),
  previewPane: $('preview-pane'),
  preview: $('preview'),
  divider: $('divider'),
  docName: $('doc-name'),
  dirtyDot: $('dirty-dot'),
  themeSelect: $('theme-select'),
  wysiwygBtn: $('btn-wysiwyg'),
  statusMode: $('status-mode'),
  statusCounts: $('status-counts'),
  statusMsg: $('status-msg'),
};

document.body.dataset.platform = bridge?.platform ?? 'browser';

// ------------------------------------------------------------------ settings

const SETTINGS_KEY = 'jmd.settings';
const settings = {
  theme: DEFAULT_THEME,
  layout: 'split',
  split: 50,
  wysiwyg: false,
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

// ------------------------------------------------------------------ document

const doc = {
  path: null,
  /** Content as it exists on disk, for the dirty check. */
  saved: '',
};

function isDirty() {
  return editor.getValue() !== doc.saved;
}

function refreshChrome() {
  const name = (bridge?.basename?.(doc.path)) ?? (doc.path ? doc.path.split(/[\\/]/).pop() : null);
  const label = name ?? 'Untitled';
  const dirty = isDirty();
  el.docName.textContent = label;
  el.docName.title = doc.path ?? '';
  el.dirtyDot.hidden = !dirty;
  bridge?.setTitle(`${dirty ? '● ' : ''}${label} — jmd`);
  bridge?.setEdited(dirty);
  bridge?.setRepresentedFile(doc.path ?? '');
}

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

// -------------------------------------------------------------------- render

const preview = new Preview(el.preview, el.previewPane);

let renderHandle = 0;
function scheduleRender() {
  cancelAnimationFrame(renderHandle);
  renderHandle = requestAnimationFrame(() => {
    preview.render(editor.getValue());
    preview.syncAtomic();
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
  },
  onAtomicClick: (line) => {
    // Read-only blocks (math, code, raw HTML) are edited in the source pane.
    setLayout('split');
    editor.goToLine(line);
    editor.focus();
  },
});

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
  for (const btn of document.querySelectorAll('.seg-btn')) {
    btn.classList.toggle('is-active', btn.dataset.layout === layout);
  }
  // The preview must be visible for in-preview editing to make sense.
  if (layout === 'editor' && previewEditor.enabled) setWysiwyg(false);
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
  el.wysiwygBtn.classList.toggle('is-active', enabled);
  el.statusMode.textContent = enabled ? 'Preview editing' : 'Source';
  saveSettings();
  if (enabled) el.preview.focus();
}

for (const btn of document.querySelectorAll('.seg-btn')) {
  btn.addEventListener('click', () => setLayout(btn.dataset.layout));
}
el.wysiwygBtn.addEventListener('click', () => setWysiwyg(!previewEditor.enabled));

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

// --------------------------------------------------------------------- theme

for (const theme of THEMES) {
  const option = document.createElement('option');
  option.value = theme.id;
  option.textContent = theme.label;
  el.themeSelect.appendChild(option);
}

function setTheme(id) {
  settings.theme = applyTheme(id);
  el.themeSelect.value = settings.theme;
  saveSettings();
}

el.themeSelect.addEventListener('change', () => setTheme(el.themeSelect.value));

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

function loadDocument(path, content) {
  const wasEditing = previewEditor.enabled;
  if (wasEditing) previewEditor.setEnabled(false);
  doc.path = path;
  doc.saved = content;
  editor.setValue(content, { silent: true });
  preview.setBasePath(path);
  preview.invalidate();
  preview.render(content);
  preview.syncAtomic();
  el.previewPane.scrollTop = 0;
  refreshChrome();
  refreshCounts();
  if (wasEditing) previewEditor.setEnabled(true);
}

async function save({ as = false } = {}) {
  previewEditor.commit({ rerender: true });
  const content = editor.getValue();
  const result = as
    ? await bridge?.saveAs({ path: doc.path, content })
    : await bridge?.save({ path: doc.path, content });
  if (!result) return false;
  doc.path = result.path;
  doc.saved = content;
  preview.setBasePath(result.path);
  refreshChrome();
  flash(`Saved ${bridge?.basename?.(result.path) ?? ''}`);
  return true;
}

function buildExportHtml() {
  previewEditor.commit({ rerender: true });
  return exportDocument({
    title: (bridge?.basename?.(doc.path) ?? 'Untitled').replace(/\.[^.]+$/, ''),
    bodyHtml: el.preview.innerHTML,
    theme: settings.theme,
  });
}

async function exportHtml() {
  const html = buildExportHtml();
  const result = await bridge?.exportHtml({ path: doc.path, html });
  if (result) flash(`Exported ${bridge?.basename?.(result.path) ?? ''}`);
}

// ------------------------------------------------------------------ menu wiring

bridge?.onFileOpened(({ path, content }) => loadDocument(path, content));
bridge?.onMenuSave(() => save());
bridge?.onMenuSaveAs(() => save({ as: true }));
bridge?.onMenuExportHtml(() => exportHtml());
bridge?.onMenuFind(() => editor.openSearch());
bridge?.onMenuLayout((layout) => setLayout(layout));
bridge?.onMenuTheme((theme) => setTheme(theme));
bridge?.onMenuToggleWysiwyg(() => setWysiwyg(!previewEditor.enabled));

// The main process asks this before reusing a window for an opened file.
window.__jmdIsEmpty = () => !doc.path && !isDirty();

// ------------------------------------------------------------- close handling

let closing = false;
window.addEventListener('beforeunload', (event) => {
  if (closing || !isDirty()) return;
  event.preventDefault();
  event.returnValue = '';
  confirmThenClose();
});

async function confirmThenClose() {
  const name = (bridge?.basename?.(doc.path)) ?? 'Untitled';
  const choice = await bridge?.confirmClose(name);
  if (choice === 'cancel') return;
  if (choice === 'save' && !(await save())) return;
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
  setWysiwyg,
  setLayout,
  setTheme,
  loadDocument,
  syncScroll,
  save,
  exportHtml,
  buildExportHtml,
  settings,
};

// ----------------------------------------------------------------- boot

setTheme(settings.theme);
setSplit(settings.split);
setLayout(settings.layout === 'editor' ? 'split' : settings.layout);

(async () => {
  const initial = new URLSearchParams(location.search).get('file');
  if (initial && bridge) {
    try {
      const { path, content } = await bridge.readFile(initial);
      loadDocument(path, content);
    } catch (error) {
      loadDocument(null, `# Could not open file\n\n\`\`\`\n${String(error)}\n\`\`\`\n`);
    }
  } else {
    loadDocument(null, WELCOME);
    doc.saved = WELCOME;
  }
  if (settings.wysiwyg) setWysiwyg(true);
  else el.statusMode.textContent = 'Source';
  editor.focus();
})();
