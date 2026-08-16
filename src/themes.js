export const THEMES = [
  { id: 'github', label: 'GitHub Light' },
  { id: 'paper', label: 'Paper' },
  { id: 'solarized-light', label: 'Solarized Light' },
  { id: 'nord', label: 'Nord' },
  { id: 'dracula', label: 'Dracula' },
  { id: 'gruvbox-dark', label: 'Gruvbox Dark' },
];

export const DEFAULT_THEME = 'github';

// ------------------------------------------------------------- text column

/**
 * The width of the text column, in rem. Two values are kept at once — the
 * everyday one and the wide one — so toggling wide mode is a switch rather
 * than a resize, the way Notion's per-page "Full width" behaves.
 */
export const DEFAULT_WIDTHS = { normal: 46, wide: 72 };

/** Narrow enough to still hold a line of prose; wide enough to fill a display. */
export const WIDTH_RANGE = { min: 30, max: 120 };

export function clampWidth(rem, fallback) {
  const value = Number(rem);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(WIDTH_RANGE.max, Math.max(WIDTH_RANGE.min, Math.round(value)));
}

/** Both widths, with anything missing or out of range filled from the defaults. */
export function normalizeWidths(widths) {
  return {
    normal: clampWidth(widths?.normal, DEFAULT_WIDTHS.normal),
    wide: clampWidth(widths?.wide, DEFAULT_WIDTHS.wide),
  };
}

/**
 * Point `--measure` at one of the two widths.
 * @param {{ wide: boolean, widths: { normal: number, wide: number } }} options
 * @returns {{ normal: number, wide: number }} the widths actually applied
 */
export function applyWidth({ wide, widths }) {
  const applied = normalizeWidths(widths);
  const style = document.documentElement.style;
  style.setProperty('--measure-normal', `${applied.normal}rem`);
  style.setProperty('--measure-wide', `${applied.wide}rem`);
  document.documentElement.dataset.width = wide ? 'wide' : 'normal';
  return applied;
}

/** Handy starting points for the accent picker. */
export const ACCENT_PRESETS = [
  '#0969da', '#1f883d', '#8250df', '#bf3989',
  '#d1242f', '#bc4c00', '#0b7a75', '#57606a',
];

export function applyTheme(id) {
  const theme = THEMES.some((t) => t.id === id) ? id : DEFAULT_THEME;
  document.documentElement.dataset.theme = theme;
  return theme;
}

/** Tokens the accent override drives; everything else stays with the theme. */
const ACCENT_TOKENS = ['--accent', '--accent-fg', '--link', '--caret', '--syn-link'];

/**
 * Tint the current theme with a custom accent colour. Passing a falsy value
 * hands the tokens back to the theme.
 * @param {string|null} color any CSS hex colour
 * @returns {string|null} the applied colour, or null when cleared
 */
export function applyAccent(color) {
  const style = document.documentElement.style;
  const hex = normalizeHex(color);
  if (!hex) {
    for (const token of ACCENT_TOKENS) style.removeProperty(token);
    return null;
  }
  style.setProperty('--accent', hex);
  style.setProperty('--accent-fg', readableOn(hex));
  style.setProperty('--link', hex);
  style.setProperty('--caret', hex);
  style.setProperty('--syn-link', hex);
  return hex;
}

export function normalizeHex(color) {
  if (typeof color !== 'string') return null;
  const value = color.trim();
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(value)) {
    return `#${[...value.slice(1)].map((c) => c + c).join('')}`.toLowerCase();
  }
  return null;
}

/** Black or white, whichever gives the higher contrast ratio against `hex`. */
export function readableOn(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const channel = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  // WCAG contrast ratio against black (luminance 0) and white (luminance 1),
  // simplified since one side of each pair is a constant 0 or 1.
  const contrastWithBlack = (luminance + 0.05) / 0.05;
  const contrastWithWhite = 1.05 / (luminance + 0.05);
  return contrastWithBlack >= contrastWithWhite ? '#101215' : '#ffffff';
}

/** The theme's own accent, read from CSS — used to seed the colour picker. */
export function themeAccent(themeId) {
  const probe = document.createElement('div');
  probe.dataset.theme = themeId;
  probe.style.display = 'none';
  document.body.appendChild(probe);
  const value = getComputedStyle(probe).getPropertyValue('--accent').trim();
  probe.remove();
  return normalizeHex(value) ?? '#0969da';
}
