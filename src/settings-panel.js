/**
 * The settings dialog: skin (theme + accent colour), editor behaviour and
 * keyboard shortcuts.
 *
 * The panel never touches storage itself — it calls back into the app, which
 * owns the settings object and persists it.
 */
import { THEMES, ACCENT_PRESETS, DEFAULT_WIDTHS, WIDTH_RANGE } from './themes.js';
import {
  ACTION_GROUPS,
  IS_MAC,
  accelFromEvent,
  actionLabel,
  formatAccel,
  isBindable,
} from './shortcuts.js';

const $ = (id) => document.getElementById(id);

export function createSettingsPanel({
  shortcuts,
  settings,
  onTheme,
  onAccent,
  onLayout,
  onWide,
  onWidths,
  onVim,
  onShortcuts,
  onSection,
}) {
  const overlay = $('settings');
  const appearance = $('pane-appearance');
  const editorPane = $('pane-editor');
  const shortcutsPane = $('pane-shortcuts');
  let recording = null;

  // ------------------------------------------------------------- appearance

  appearance.innerHTML = `
    <div class="field">
      <div class="field-label">Layout</div>
      <div class="field-hint">Choose how the editor and preview are arranged.</div>
      <div class="setting-seg" id="layout-setting" role="group" aria-label="Layout">
        <button type="button" class="btn" data-layout="editor">Editor</button>
        <button type="button" class="btn" data-layout="split">Split</button>
        <button type="button" class="btn" data-layout="preview">Preview</button>
      </div>
    </div>
    <div class="field">
      <div class="field-label">Content width</div>
      <div class="field-hint">
        How wide the text column grows before it stops. Switch to Wide${wideHint()}
        or from the status bar — it earns its keep on a big screen or a
        table-heavy document.
      </div>
      <div class="setting-seg" id="width-setting" role="group" aria-label="Content width">
        <button type="button" class="btn" data-wide="normal">Normal</button>
        <button type="button" class="btn" data-wide="wide">Wide</button>
      </div>
      <div class="width-rows">
        ${widthRow('normal', 'Normal')}
        ${widthRow('wide', 'Wide')}
      </div>
      <button type="button" class="btn" id="width-reset">Restore default widths</button>
    </div>
    <div class="field">
      <div class="field-label">Skin</div>
      <div class="field-hint">The colour scheme for the editor, the preview and the app chrome.</div>
      <div class="skins" id="skin-grid"></div>
    </div>
    <div class="field">
      <div class="field-label">Accent colour</div>
      <div class="field-hint">Tints links, the caret and the active controls on top of the skin.</div>
      <div class="accent-row">
        <input type="color" id="accent-input" class="accent-input" aria-label="Accent colour" />
        <div class="accent-presets" id="accent-presets"></div>
        <button type="button" class="btn" id="accent-reset">Use skin default</button>
      </div>
    </div>`;

  /** The current binding for the wide toggle, mentioned in the hint. */
  function wideHint() {
    const accel = shortcuts.primary('view.wide');
    return accel ? ` with <b>${formatAccel(accel)}</b>` : '';
  }

  function widthRow(key, label) {
    return `
      <label class="width-row">
        <span class="width-name">${label}</span>
        <input type="range" class="width-range" id="width-${key}"
          min="${WIDTH_RANGE.min}" max="${WIDTH_RANGE.max}" step="1" />
        <output class="width-value" id="width-${key}-value"></output>
      </label>`;
  }

  const skinGrid = $('skin-grid');
  const layoutSetting = $('layout-setting');
  for (const button of layoutSetting.children) {
    button.addEventListener('click', () => {
      onLayout(button.dataset.layout);
      syncAppearance();
    });
  }

  const widthSetting = $('width-setting');
  for (const button of widthSetting.children) {
    button.addEventListener('click', () => onWide(button.dataset.wide === 'wide'));
  }
  // Dragging a slider retargets the mode it belongs to, so the change you are
  // making is the one on screen.
  for (const key of ['normal', 'wide']) {
    $(`width-${key}`).addEventListener('input', (event) => {
      if (settings.wide !== (key === 'wide')) onWide(key === 'wide');
      onWidths({ [key]: Number(event.target.value) });
    });
  }
  $('width-reset').addEventListener('click', () => onWidths({ ...DEFAULT_WIDTHS }));
  for (const theme of THEMES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'skin';
    button.dataset.theme = theme.id;
    button.innerHTML = `
      <span class="skin-swatch">
        <span class="skin-bar"></span>
        <span class="skin-text">Aa</span>
        <span class="skin-accent"></span>
      </span>
      <span class="skin-name">${theme.label}</span>`;
    button.addEventListener('click', () => {
      onTheme(theme.id);
      syncAppearance();
    });
    skinGrid.appendChild(button);
  }

  const accentInput = $('accent-input');
  const accentPresets = $('accent-presets');
  for (const color of ACCENT_PRESETS) {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'accent-dot';
    dot.style.background = color;
    dot.title = color;
    dot.setAttribute('aria-label', `Accent ${color}`);
    dot.addEventListener('click', () => {
      onAccent(color);
      syncAppearance();
    });
    accentPresets.appendChild(dot);
  }
  accentInput.addEventListener('input', () => onAccent(accentInput.value));
  accentInput.addEventListener('change', () => syncAppearance());
  $('accent-reset').addEventListener('click', () => {
    onAccent(null);
    syncAppearance();
  });

  function syncAppearance() {
    for (const button of layoutSetting.children) {
      button.classList.toggle('is-active', button.dataset.layout === settings.layout);
    }
    for (const button of widthSetting.children) {
      button.classList.toggle('is-active', (button.dataset.wide === 'wide') === !!settings.wide);
    }
    for (const key of ['normal', 'wide']) {
      const rem = settings.widths?.[key] ?? DEFAULT_WIDTHS[key];
      $(`width-${key}`).value = String(rem);
      $(`width-${key}-value`).textContent = `${rem} rem`;
      $(`width-${key}`).closest('.width-row')
        .classList.toggle('is-active', (key === 'wide') === !!settings.wide);
    }
    $('width-reset').disabled =
      settings.widths?.normal === DEFAULT_WIDTHS.normal &&
      settings.widths?.wide === DEFAULT_WIDTHS.wide;
    for (const button of skinGrid.children) {
      button.classList.toggle('is-active', button.dataset.theme === settings.theme);
    }
    const accent = settings.accent ?? currentAccent();
    accentInput.value = accent;
    for (const dot of accentPresets.children) {
      dot.classList.toggle('is-active', settings.accent === dot.title);
    }
    $('accent-reset').disabled = !settings.accent;
  }

  function currentAccent() {
    const value = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    return /^#[0-9a-f]{6}$/i.test(value) ? value : '#0969da';
  }

  // ----------------------------------------------------------------- editor

  /**
   * What vim mode actually gives you, so the toggle is not a leap of faith.
   * Deliberately the common ground rather than an exhaustive list.
   */
  const VIM_KEYS = [
    ['Modes', 'i a I A o O', 'v V Ctrl-v', 'R', 'Esc'],
    ['Motions', 'h j k l', 'w b e ge', '0 ^ $', 'gg G 42G', '{ } ( )', 'f t F T ; ,', '% Ctrl-d Ctrl-u'],
    ['Edits', 'x s r J', 'd c y p P', 'dd cc yy', '>> << ==', 'u Ctrl-r', '.'],
    ['Text objects', 'iw aw', 'i" a" i( a( i{ a{', 'ip ap it at'],
    ['Search', '/ ? n N', '* #', ':%s/old/new/g', ':noh'],
    ['Marks, registers, macros', 'ma \'a `a', '"ay "ap', 'qa @a @@'],
    ['Counts and repeats', '3w d2w 5dd', '10j'],
    ['This document', ':w', ':wq :x', ':q :q!', ':qa'],
  ];

  editorPane.innerHTML = `
    <div class="field">
      <div class="field-label">Vim mode</div>
      <div class="field-hint">
        Modal editing in the source pane${vimHint()}. Off by default, and the
        source pane's alone: the preview is rich text with its own idea of what a
        keystroke means, so turning vim on hands the keyboard back to the
        Markdown, which is where these keys are worth having.
      </div>
      <div class="setting-seg" id="vim-setting" role="group" aria-label="Vim mode">
        <button type="button" class="btn" data-vim="off">Off</button>
        <button type="button" class="btn" data-vim="on">On</button>
      </div>
    </div>
    <div class="field">
      <div class="field-label">What is bound</div>
      <div class="field-hint">
        Operators, motions, counts and registers compose the way they do in vim,
        so this is a reminder rather than the whole set.
      </div>
      <div class="vim-help">${VIM_KEYS.map(vimHelpRow).join('')}</div>
    </div>`;

  /** The current binding for the vim toggle, mentioned in the hint. */
  function vimHint() {
    const accel = shortcuts.primary('editor.vim');
    return accel ? `, on and off with <b>${formatAccel(accel)}</b>` : '';
  }

  function vimHelpRow([label, ...groups]) {
    const keys = groups
      .map((group) => `<span class="vim-keys">${group
        .split(' ')
        .map((key) => `<kbd>${key.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</kbd>`)
        .join('')}</span>`)
      .join('');
    return `
      <div class="vim-help-row">
        <span class="vim-help-name">${label}</span>
        <span class="vim-help-keys">${keys}</span>
      </div>`;
  }

  const vimSetting = $('vim-setting');
  for (const button of vimSetting.children) {
    button.addEventListener('click', () => {
      onVim(button.dataset.vim === 'on');
      syncEditor();
    });
  }

  function syncEditor() {
    for (const button of vimSetting.children) {
      button.classList.toggle('is-active', (button.dataset.vim === 'on') === !!settings.vim);
    }
  }

  // -------------------------------------------------------------- shortcuts

  shortcutsPane.innerHTML = `
    <div class="field-hint shortcut-note">
      Click a shortcut to record a new one; <b>Esc</b> cancels, <b>Backspace</b> clears.
      Every shortcut needs ${IS_MAC ? '⌘, ⌃ or ⌥' : 'Ctrl or Alt'} (or a function key).
      ${IS_MAC ? '<br />macOS reserves ⌘⇥ for its own app switcher, so ⌃⇥ is bound alongside it.' : ''}
    </div>
    <div id="shortcut-groups"></div>
    <div class="dialog-foot">
      <button type="button" class="btn" id="shortcut-reset">Restore defaults</button>
      <span class="shortcut-status" id="shortcut-status"></span>
    </div>`;

  const groupsHost = $('shortcut-groups');
  const status = $('shortcut-status');

  $('shortcut-reset').addEventListener('click', () => {
    shortcuts.reset();
    onShortcuts();
    renderShortcuts();
    say('Shortcuts restored to defaults.');
  });

  function say(message) {
    status.textContent = message;
    clearTimeout(say.timer);
    say.timer = setTimeout(() => {
      status.textContent = '';
    }, 3000);
  }

  function renderShortcuts() {
    groupsHost.textContent = '';
    for (const group of ACTION_GROUPS) {
      const section = document.createElement('div');
      section.className = 'shortcut-group';
      section.innerHTML = `<div class="field-label">${group.label}</div>`;
      for (const action of group.actions) {
        section.appendChild(renderRow(action));
      }
      groupsHost.appendChild(section);
    }
  }

  function renderRow(action) {
    const row = document.createElement('div');
    row.className = 'shortcut-row';
    row.innerHTML = `<span class="shortcut-label">${action.label}</span>`;

    const keys = document.createElement('div');
    keys.className = 'shortcut-keys';
    for (const accel of shortcuts.get(action.id)) {
      keys.appendChild(chip(action.id, accel));
    }

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'chip chip-add';
    add.title = 'Add another shortcut';
    add.textContent = '+';
    add.addEventListener('click', () => record(add, action.id, null));
    keys.appendChild(add);

    row.appendChild(keys);
    return row;
  }

  function chip(actionId, accel) {
    const wrap = document.createElement('span');
    wrap.className = 'chip-wrap';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip';
    button.textContent = formatAccel(accel);
    button.title = accel;
    button.addEventListener('click', () => record(button, actionId, accel));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'chip-remove';
    remove.title = 'Remove';
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      shortcuts.remove(actionId, accel);
      onShortcuts();
      renderShortcuts();
      say(`Removed ${formatAccel(accel)} from ${actionLabel(actionId)}.`);
    });
    wrap.append(button, remove);
    return wrap;
  }

  /** Put a chip into "press the keys" mode until a usable combo arrives. */
  function record(button, actionId, replacing) {
    stopRecording();
    recording = { button, actionId, replacing, previous: button.textContent };
    shortcuts.suspended = true;
    button.classList.add('is-recording');
    button.textContent = 'Press keys…';
    button.focus();
    window.addEventListener('keydown', onRecordKey, true);
  }

  function stopRecording() {
    if (!recording) return;
    window.removeEventListener('keydown', onRecordKey, true);
    recording.button.classList.remove('is-recording');
    recording.button.textContent = recording.previous;
    recording = null;
    shortcuts.suspended = false;
  }

  function onRecordKey(event) {
    if (!recording) return;
    event.preventDefault();
    event.stopPropagation();
    const accel = accelFromEvent(event);
    if (!accel) return; // a lone modifier: keep waiting

    const { actionId, replacing } = recording;
    if (accel === 'Esc') {
      stopRecording();
      return;
    }
    if (accel === 'Backspace' || accel === 'Delete') {
      stopRecording();
      if (replacing) {
        shortcuts.remove(actionId, replacing);
        onShortcuts();
        renderShortcuts();
      }
      return;
    }
    if (!isBindable(accel)) {
      recording.button.textContent = 'Needs a modifier…';
      return;
    }

    const stolen = shortcuts.assign(actionId, accel, replacing);
    stopRecording();
    onShortcuts();
    renderShortcuts();
    say(
      stolen
        ? `${formatAccel(accel)} → ${actionLabel(actionId)} (taken from ${actionLabel(stolen)}).`
        : `${formatAccel(accel)} → ${actionLabel(actionId)}.`,
    );
  }

  // ------------------------------------------------------------------ shell

  const sections = { appearance, editor: editorPane, shortcuts: shortcutsPane };

  function show(section) {
    for (const [name, pane] of Object.entries(sections)) pane.hidden = name !== section;
    for (const button of overlay.querySelectorAll('.nav-btn')) {
      button.classList.toggle('is-active', button.dataset.section === section);
    }
    // The panel reopens where it was left, here and in the next session.
    onSection?.(section);
  }

  for (const button of overlay.querySelectorAll('.nav-btn')) {
    button.addEventListener('click', () => show(button.dataset.section));
  }
  $('settings-close').addEventListener('click', () => close());
  overlay.addEventListener('mousedown', (event) => {
    if (event.target === overlay) close();
  });
  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !recording) {
      event.stopPropagation();
      close();
    }
  });

  function open(section = settings.settingsSection) {
    syncAppearance();
    syncEditor();
    renderShortcuts();
    show(Object.hasOwn(sections, section ?? '') ? section : 'appearance');
    overlay.hidden = false;
    overlay.querySelector('.nav-btn.is-active')?.focus();
  }

  function close() {
    stopRecording();
    overlay.hidden = true;
  }

  return {
    open,
    close,
    toggle: (section) => (overlay.hidden ? open(section) : close()),
    get isOpen() {
      return !overlay.hidden;
    },
    syncAppearance,
    syncEditor,
  };
}
