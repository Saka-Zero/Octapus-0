/**
 * OpenCode-style semantic theme system.
 * Restrained monochrome base + ONE accent carrying action/active state.
 * Tokens mirror opencode's theme.json vocabulary.
 */
export interface Theme {
  name: string;
  label: string;
  primary: string;      // user prompt marker, active elements
  accent: string;       // brand / spinner / highlights
  text: string;         // main text
  textMuted: string;    // secondary/hints
  border: string;       // subtle chrome borders
  borderActive: string; // focused (input) border
  success: string;
  error: string;
  warning: string;
  diffAdded: string;
  diffRemoved: string;
}

export const THEMES: Record<string, Theme> = {
  octapus: {
    name: 'octapus', label: 'Octapus Dark',
    primary: '#7aa2f7', accent: '#bb9af7', text: '#c0caf5', textMuted: '#565f89',
    border: '#292e42', borderActive: '#7aa2f7',
    success: '#9ece6a', error: '#f7768e', warning: '#e0af68',
    diffAdded: '#9ece6a', diffRemoved: '#f7768e'
  },
  tokyonight: {
    name: 'tokyonight', label: 'Tokyonight',
    primary: '#7aa2f7', accent: '#bb9af7', text: '#c0caf5', textMuted: '#565f89',
    border: '#1f2335', borderActive: '#7dcfff',
    success: '#9ece6a', error: '#f7768e', warning: '#e0af68',
    diffAdded: '#9ece6a', diffRemoved: '#f7768e'
  },
  catppuccin: {
    name: 'catppuccin', label: 'Catppuccin Mocha',
    primary: '#89b4fa', accent: '#cba6f7', text: '#cdd6f4', textMuted: '#6c7086',
    border: '#313244', borderActive: '#89dceb',
    success: '#a6e3a1', error: '#f38ba8', warning: '#fab387',
    diffAdded: '#a6e3a1', diffRemoved: '#f38ba8'
  },
  gruvbox: {
    name: 'gruvbox', label: 'Gruvbox Dark',
    primary: '#83a598', accent: '#d3869b', text: '#ebdbb2', textMuted: '#928374',
    border: '#3c3836', borderActive: '#fabd2f',
    success: '#b8bb26', error: '#fb4934', warning: '#fe8019',
    diffAdded: '#b8bb26', diffRemoved: '#fb4934'
  },
  'one-dark': {
    name: 'one-dark', label: 'Atom One Dark',
    primary: '#61afef', accent: '#c678dd', text: '#abb2bf', textMuted: '#5c6370',
    border: '#3e4451', borderActive: '#56b6c2',
    success: '#98c379', error: '#e06c75', warning: '#d19a66',
    diffAdded: '#98c379', diffRemoved: '#e06c75'
  },
  nord: {
    name: 'nord', label: 'Nord',
    primary: '#88c0d0', accent: '#b48ead', text: '#eceff4', textMuted: '#4c566a',
    border: '#3b4252', borderActive: '#88c0d0',
    success: '#a3be8c', error: '#bf616a', warning: '#d08770',
    diffAdded: '#a3be8c', diffRemoved: '#bf616a'
  },
  matrix: {
    name: 'matrix', label: 'Matrix',
    primary: '#00ff41', accent: '#00cc33', text: '#00ff41', textMuted: '#008b11',
    border: '#003b0f', borderActive: '#00ff41',
    success: '#00ff41', error: '#ff5555', warning: '#e0af68',
    diffAdded: '#00ff41', diffRemoved: '#ff5555'
  },
  phosphor: {
    name: 'phosphor', label: 'Phosphor Green (opencode brand)',
    primary: '#50fa7b', accent: '#50fa7b', text: '#d2d2d2', textMuted: '#8a8a8a',
    border: '#2a2a2a', borderActive: '#50fa7b',
    success: '#50fa7b', error: '#ff5555', warning: '#f1fa8c',
    diffAdded: '#50fa7b', diffRemoved: '#ff5555'
  },
  light: {
    name: 'light', label: 'Light',
    primary: '#0969da', accent: '#8250df', text: '#24292f', textMuted: '#656d76',
    border: '#d0d7de', borderActive: '#0969da',
    success: '#1a7f37', error: '#cf222e', warning: '#9a6700',
    diffAdded: '#1a7f37', diffRemoved: '#cf222e'
  }
};

export function getTheme(name?: string): Theme {
  return (name && THEMES[name]) || THEMES.octapus;
}

export function listThemeNames(): string[] {
  return Object.keys(THEMES);
}
