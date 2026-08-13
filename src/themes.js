export const THEMES = [
  { id: 'github', label: 'GitHub Light' },
  { id: 'paper', label: 'Paper' },
  { id: 'solarized-light', label: 'Solarized Light' },
  { id: 'nord', label: 'Nord' },
  { id: 'dracula', label: 'Dracula' },
  { id: 'gruvbox-dark', label: 'Gruvbox Dark' },
];

export const DEFAULT_THEME = 'github';

export function applyTheme(id) {
  const theme = THEMES.some((t) => t.id === id) ? id : DEFAULT_THEME;
  document.documentElement.dataset.theme = theme;
  return theme;
}
