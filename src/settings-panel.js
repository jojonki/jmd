/**
 * The settings dialog: skin (theme + accent colour) and keyboard shortcuts.
 *
 * The panel never touches storage itself — it calls back into the app, which
 * owns the settings object and persists it.
 */
import { THEMES, ACCENT_PRESETS } from './themes.js';
import {
  ACTION_GROUPS,
  IS_MAC,
  accelFromEvent,
  actionLabel,
  formatAccel,
  isBindable,
} from './shortcuts.js';

const $ = (id) => document.getElementById(id);

export function createSettingsPanel({ shortcuts, settings, onTheme, onAccent, onLayout, onShortcuts }) {
  const overlay = $('settings');
  const appearance = $('pane-appearance');
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

  const skinGrid = $('skin-grid');
  const layoutSetting = $('layout-setting');
  for (const button of layoutSetting.children) {
    button.addEventListener('click', () => {
      onLayout(button.dataset.layout);
      syncAppearance();
    });
  }
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

  const sections = { appearance, shortcuts: shortcutsPane };

  function show(section) {
    for (const [name, pane] of Object.entries(sections)) pane.hidden = name !== section;
    for (const button of overlay.querySelectorAll('.nav-btn')) {
      button.classList.toggle('is-active', button.dataset.section === section);
    }
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

  function open(section = 'appearance') {
    syncAppearance();
    renderShortcuts();
    show(section);
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
  };
}
