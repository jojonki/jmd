/**
 * Keyboard shortcuts.
 *
 * Every configurable command lives here as an *action id*; the renderer owns
 * the actual dispatch (a capturing keydown listener) so a binding can be
 * changed at runtime without rebuilding anything. The menu in the main process
 * only displays the bindings — see `bridge.setMenuAccelerators`.
 *
 * An accelerator is stored as a canonical string: modifiers in the fixed order
 * `Cmd+Ctrl+Alt+Shift`, then one key name (`T`, `3`, `Tab`, `,`).
 */

const mac =
  (typeof window !== 'undefined' && window.jmd?.platform === 'darwin') ||
  (typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform ?? ''));

export const IS_MAC = mac;

/** The platform's primary modifier. */
const MOD = mac ? 'Cmd' : 'Ctrl';
/** Layout switching sits one modifier deeper so ⌘+digit can drive the tabs. */
const VIEW_MOD = mac ? 'Cmd+Ctrl' : 'Ctrl+Alt';

// --------------------------------------------------------------- key naming

/** Physical-key names, so ⌥/⇧ combinations still report the printed key. */
const CODE_KEYS = {
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Space: 'Space',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Tab: 'Tab',
  Escape: 'Esc',
  Backspace: 'Backspace',
  Delete: 'Delete',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
};

const MODIFIER_ORDER = ['Cmd', 'Ctrl', 'Alt', 'Shift'];

const MODIFIER_ALIASES = {
  cmd: 'Cmd',
  command: 'Cmd',
  meta: 'Cmd',
  super: 'Cmd',
  ctrl: 'Ctrl',
  control: 'Ctrl',
  alt: 'Alt',
  option: 'Alt',
  opt: 'Alt',
  shift: 'Shift',
};

// ----------------------------------------------------------------- actions

const numberedTabs = Array.from({ length: 8 }, (_, i) => ({
  id: `tab.${i + 1}`,
  label: `Tab ${i + 1}`,
  defaults: [`${MOD}+${i + 1}`],
}));

export const ACTION_GROUPS = [
  {
    label: 'Tabs',
    actions: [
      { id: 'tab.new', label: 'New tab', defaults: [`${MOD}+T`] },
      { id: 'tab.close', label: 'Close tab', defaults: [`${MOD}+W`] },
      { id: 'tab.next', label: 'Next tab', defaults: [`${MOD}+Tab`, 'Ctrl+Tab'] },
      { id: 'tab.prev', label: 'Previous tab', defaults: [`${MOD}+Shift+Tab`, 'Ctrl+Shift+Tab'] },
      ...numberedTabs,
      { id: 'tab.last', label: 'Last tab', defaults: [`${MOD}+9`] },
    ],
  },
  {
    label: 'View',
    actions: [
      { id: 'layout.editor', label: 'Editor only', defaults: [`${VIEW_MOD}+1`] },
      { id: 'layout.split', label: 'Split', defaults: [`${VIEW_MOD}+2`] },
      { id: 'layout.preview', label: 'Preview only', defaults: [`${VIEW_MOD}+3`] },
      { id: 'view.wide', label: 'Wide width', defaults: [`${VIEW_MOD}+W`] },
      { id: 'view.wysiwyg', label: 'Edit in preview', defaults: [`${MOD}+E`] },
      { id: 'editor.vim', label: 'Vim mode', defaults: [`${VIEW_MOD}+V`] },
      { id: 'find.preview', label: 'Find in preview', defaults: [`${MOD}+Shift+F`] },
    ],
  },
  {
    label: 'File',
    actions: [
      { id: 'file.reveal', label: 'Reveal in file manager', defaults: [`${MOD}+Shift+R`] },
      { id: 'app.settings', label: 'Settings', defaults: [`${MOD}+,`] },
    ],
  },
];

export const ACTIONS = ACTION_GROUPS.flatMap((group) => group.actions);

export const DEFAULT_BINDINGS = Object.fromEntries(
  ACTIONS.map((action) => [action.id, unique(action.defaults.map(normalizeAccel))]),
);

const ACTION_LABELS = new Map(ACTIONS.map((action) => [action.id, action.label]));

export function actionLabel(id) {
  return ACTION_LABELS.get(id) ?? id;
}

/** The key part of an accelerator for `event`, or null for a bare modifier. */
export function keyName(event) {
  const code = event.code ?? '';
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return code.slice(6);
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^F\d{1,2}$/.test(code)) return code;
  if (CODE_KEYS[code]) return CODE_KEYS[code];

  const key = event.key ?? '';
  if (!key || ['Meta', 'Control', 'Alt', 'Shift', 'Dead', 'Unidentified'].includes(key)) return null;
  if (key === ' ') return 'Space';
  if (key === 'Escape') return 'Esc';
  if (key.startsWith('Arrow')) return key.slice(5);
  return key.length === 1 ? key.toUpperCase() : key;
}

/** Canonical accelerator for a keyboard event, or null if it is unusable. */
export function accelFromEvent(event) {
  const key = keyName(event);
  if (!key) return null;
  const parts = [];
  if (event.metaKey) parts.push('Cmd');
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

export function normalizeAccel(accel) {
  if (typeof accel !== 'string' || !accel.trim()) return null;
  // Split on '+' but keep a literal '+' key ("Cmd++") intact.
  const raw = accel.trim().split('+');
  const parts = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '' && i > 0 && i < raw.length - 1) {
      parts.push('+');
      i++;
    } else if (raw[i] !== '') {
      parts.push(raw[i]);
    }
  }
  if (!parts.length) return null;

  const mods = new Set();
  let key = null;
  for (const part of parts) {
    const modifier = MODIFIER_ALIASES[part.toLowerCase()];
    if (modifier) mods.add(modifier);
    else key = part.length === 1 ? part.toUpperCase() : titleCaseKey(part);
  }
  if (!key) return null;
  return [...MODIFIER_ORDER.filter((m) => mods.has(m)), key].join('+');
}

function titleCaseKey(key) {
  const known = ['Tab', 'Enter', 'Esc', 'Space', 'Backspace', 'Delete', 'Up', 'Down', 'Left',
    'Right', 'Home', 'End', 'PageUp', 'PageDown'];
  const match = known.find((k) => k.toLowerCase() === key.toLowerCase());
  if (match) return match;
  if (/^f\d{1,2}$/i.test(key)) return key.toUpperCase();
  return key;
}

/** True when the accelerator is safe to bind (i.e. cannot swallow typing). */
export function isBindable(accel) {
  if (!accel) return false;
  if (/^F\d{1,2}$/.test(accel)) return true;
  return /^(Cmd|Ctrl|Alt)\+/.test(accel);
}

// ------------------------------------------------------------------ display

const MAC_MODIFIERS = { Cmd: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧' };
const MAC_KEYS = {
  Tab: '⇥',
  Enter: '↩',
  Esc: '⎋',
  Backspace: '⌫',
  Delete: '⌦',
  Space: '␣',
  Up: '↑',
  Down: '↓',
  Left: '←',
  Right: '→',
};

/** Human-readable form: `⌘⇧T` on macOS, `Ctrl+Shift+T` elsewhere. */
export function formatAccel(accel) {
  if (!accel) return '';
  const parts = accel.split('+').filter(Boolean);
  const key = parts.pop();
  if (!mac) return [...parts, key].join('+');
  return parts.map((m) => MAC_MODIFIERS[m] ?? m).join('') + (MAC_KEYS[key] ?? key);
}

/** Electron's accelerator syntax, for menu display. */
export function toElectronAccel(accel) {
  if (!accel) return undefined;
  const parts = accel.split('+').filter(Boolean);
  const key = parts.pop();
  const mods = parts.map((m) => ({ Cmd: 'Command', Ctrl: 'Control' })[m] ?? m);
  const named = { Esc: 'Escape', Up: 'Up', Down: 'Down', Left: 'Left', Right: 'Right' };
  return [...mods, named[key] ?? key].join('+');
}

// ------------------------------------------------------------------ registry

function unique(list) {
  return [...new Set(list.filter(Boolean))];
}

/**
 * The live binding table. Reads a saved `{ actionId: [accel, …] }` map, falls
 * back to the defaults for anything missing, and answers `lookup(accel)`.
 */
export class Shortcuts {
  constructor(saved) {
    /** Set while the settings panel is recording, so nothing fires meanwhile. */
    this.suspended = false;
    this.load(saved);
  }

  load(saved) {
    this.bindings = {};
    for (const action of ACTIONS) {
      const stored = saved?.[action.id];
      this.bindings[action.id] = Array.isArray(stored)
        ? unique(stored.map(normalizeAccel).filter(isBindable))
        : [...DEFAULT_BINDINGS[action.id]];
    }
    this.#reindex();
  }

  #reindex() {
    this.index = new Map();
    for (const [id, accels] of Object.entries(this.bindings)) {
      for (const accel of accels) if (!this.index.has(accel)) this.index.set(accel, id);
    }
  }

  get(id) {
    return this.bindings[id] ?? [];
  }

  /** First binding, which is the one the menu displays. */
  primary(id) {
    return this.bindings[id]?.[0] ?? null;
  }

  /**
   * Bind `accel` to `id`, taking it away from whichever action held it.
   * @returns {string|null} the action that lost the binding, if any
   */
  assign(id, accel, replacing = null) {
    const normalized = normalizeAccel(accel);
    if (!isBindable(normalized)) return null;
    let stolenFrom = null;
    for (const [other, accels] of Object.entries(this.bindings)) {
      const at = accels.indexOf(normalized);
      if (at >= 0 && other !== id) {
        accels.splice(at, 1);
        stolenFrom = other;
      }
    }
    const list = this.bindings[id] ?? (this.bindings[id] = []);
    const slot = replacing ? list.indexOf(normalizeAccel(replacing)) : -1;
    if (slot >= 0) list[slot] = normalized;
    else if (!list.includes(normalized)) list.push(normalized);
    this.bindings[id] = unique(list);
    this.#reindex();
    return stolenFrom;
  }

  remove(id, accel) {
    const normalized = normalizeAccel(accel);
    this.bindings[id] = (this.bindings[id] ?? []).filter((a) => a !== normalized);
    this.#reindex();
  }

  reset() {
    this.load(null);
  }

  isDefault(id) {
    const current = this.bindings[id] ?? [];
    const fallback = DEFAULT_BINDINGS[id] ?? [];
    return current.length === fallback.length && current.every((a, i) => a === fallback[i]);
  }

  /** Action id bound to a keyboard event, or null. */
  match(event) {
    if (this.suspended) return null;
    const accel = accelFromEvent(event);
    return accel ? this.index.get(accel) ?? null : null;
  }

  /** Serializable snapshot for settings storage. */
  toJSON() {
    return { ...this.bindings };
  }

  /** `{ actionId: electronAccelerator }` for the application menu. */
  menuAccelerators() {
    const out = {};
    for (const id of Object.keys(this.bindings)) {
      const accel = this.primary(id);
      if (accel) out[id] = toElectronAccel(accel);
    }
    return out;
  }
}
