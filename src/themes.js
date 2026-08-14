export const THEMES = [
  { id: 'github', label: 'GitHub Light' },
  { id: 'paper', label: 'Paper' },
  { id: 'solarized-light', label: 'Solarized Light' },
  { id: 'nord', label: 'Nord' },
  { id: 'dracula', label: 'Dracula' },
  { id: 'gruvbox-dark', label: 'Gruvbox Dark' },
];

export const DEFAULT_THEME = 'github';

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

/** Black or white, whichever stays legible on `hex`. */
export function readableOn(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const channel = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  return luminance > 0.45 ? '#101215' : '#ffffff';
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
