/**
 * TUI theme system — semantic color tokens used across ChatApp.
 * Markdown (chalk) keeps global colors; themes style the chrome.
 */
export interface Theme {
  name: string;
  label: string;
  border: string;      // header/status/picker borders
  accent: string;      // brand accents, spinner
  userLabel: string;   // "You ›"
  userText: string;
  aiLabel: string;     // "Octapus ›"
  highlight: string;   // current model star, selected rows
  dim: string;
  success: string;
  error: string;
  warn: string;
}

export const THEMES: Record<string, Theme> = {
  octapus: {
    name: 'octapus', label: '🐙 Octapus Dark (default)',
    border: 'cyan', accent: 'magenta',
    userLabel: 'green', userText: 'white',
    aiLabel: 'cyan', highlight: 'yellow',
    dim: 'gray', success: 'green', error: 'red', warn: 'yellow'
  },
  dracula: {
    name: 'dracula', label: '🧛 Dracula',
    border: '#bd93f9', accent: '#ff79c6',
    userLabel: '#50fa7b', userText: '#f8f8f2',
    aiLabel: '#8be9fd', highlight: '#f1fa8c',
    dim: '#6272a4', success: '#50fa7b', error: '#ff5555', warn: '#ffb86c'
  },
  nord: {
    name: 'nord', label: '❄️ Nord',
    border: '#88c0d0', accent: '#b48ead',
    userLabel: '#a3be8c', userText: '#eceff4',
    aiLabel: '#81a1c1', highlight: '#ebcb8b',
    dim: '#4c566a', success: '#a3be8c', error: '#bf616a', warn: '#d08770'
  },
  light: {
    name: 'light', label: '☀️ Light',
    border: '#0969da', accent: '#8250df',
    userLabel: '#1a7f37', userText: '#24292f',
    aiLabel: '#0550ae', highlight: '#9a6700',
    dim: '#656d76', success: '#1a7f37', error: '#cf222e', warn: '#9a6700'
  }
};

export function getTheme(name?: string): Theme {
  return (name && THEMES[name]) || THEMES.octapus;
}

export function listThemeNames(): string[] {
  return Object.keys(THEMES);
}
