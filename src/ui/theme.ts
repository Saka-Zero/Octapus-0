/**
 * Semantic theme system faithful to OpenCode's Go source.
 *
 * OpenCode's message.go maps:
 *   user border     → theme.Secondary().Faint(true)
 *   assistant border → theme.Primary().Faint(true)
 *   system/tool     → theme.Accent().Faint(true)
 *   focused input   → theme.BorderFocused() (≈ Primary)
 *   unfocused input → theme.BorderNormal() (≈ DimBorder)
 *
 * Theme interface mirrors OpenCode's Theme interface in theme/theme.go.
 */
export interface Theme {
  name: string;
  label: string;

  /** Assistant-side: assistant border, text color for assistant content */
  primary: string;
  /** User-side: user border color */
  secondary: string;
  /** System/tool accent color */
  accent: string;

  /** Main body text (assistant content, lists, etc.) */
  text: string;
  /** Muted / secondary text */
  textMuted: string;
  /** Emphasized text */
  textEmphasized: string;

  /** Main background */
  background: string;
  /** Secondary background (panels, code blocks) */
  backgroundSecondary: string;
  /** Darker background (code block interior) */
  backgroundDarker: string;

  /** Normal/unfocused border */
  border: string;
  /** Focused input border (≈ Primary in OpenCode) */
  borderFocused: string;
  /** Dim / inactive border */
  borderDim: string;

  success: string;
  error: string;
  warning: string;
  info: string;

  /** Diff: added lines */
  diffAdded: string;
  /** Diff: removed lines */
  diffRemoved: string;
  /** Diff: added line number gutter */
  diffAddedLineNumber: string;
  /** Diff: removed line number gutter */
  diffRemovedLineNumber: string;
  /** Diff: header / function context */
  diffHeader: string;
  /** Diff: hunk header */
  diffHunk: string;

  /** Markdown heading */
  mdHeading: string;
  /** Markdown bold */
  mdBold: string;
  /** Markdown italic */
  mdItalic: string;
  /** Markdown code */
  mdCode: string;
  /** Markdown code fence border */
  mdCodeFence: string;
  /** Markdown link */
  mdLink: string;
  /** Markdown image */
  mdImage: string;
  /** Markdown blockquote prefix */
  mdBlockquote: string;
  /** Markdown list bullet */
  mdBullet: string;
  /** Markdown ordered list number */
  mdOrdered: string;
  /** Markdown horizontal rule */
  mdRule: string;
}

export const THEMES: Record<string, Theme> = {
  // ─── OpenCode Dark (the real palette from opencode.go) ───
  'opencode-dark': {
    name: 'opencode-dark', label: 'OpenCode Dark',
    primary: '#fab283', secondary: '#5c9cf5', accent: '#9d7cd8',
    text: '#e0e0e0', textMuted: '#6a6a6a', textEmphasized: '#f5f5f5',
    background: '#212121', backgroundSecondary: '#2a2a2a', backgroundDarker: '#1a1a1a',
    border: '#4b4c5c', borderFocused: '#fab283', borderDim: '#3a3a3a',
    success: '#7fd88f', error: '#e06c75', warning: '#e5c07b', info: '#56b6c2',
    diffAdded: '#7fd88f', diffRemoved: '#e06c75',
    diffAddedLineNumber: '#4b8c4b', diffRemovedLineNumber: '#8c4b4b',
    diffHeader: '#e5c07b', diffHunk: '#9d7cd8',
    mdHeading: '#fab283', mdBold: '#f5f5f5', mdItalic: '#c5a8e0',
    mdCode: '#56b6c2', mdCodeFence: '#4b4c5c', mdLink: '#5c9cf5',
    mdImage: '#9d7cd8', mdBlockquote: '#6a6a6a', mdBullet: '#56b6c2',
    mdOrdered: '#56b6c2', mdRule: '#4b4c5c',
  },

  // ─── Octapus Dark (current default, kept for compat) ───
  octapus: {
    name: 'octapus', label: 'Octapus Dark',
    primary: '#7aa2f7', secondary: '#7dcfff', accent: '#bb9af7',
    text: '#c0caf5', textMuted: '#565f89', textEmphasized: '#e0e0e0',
    background: '#1a1b26', backgroundSecondary: '#1f2335', backgroundDarker: '#14141e',
    border: '#292e42', borderFocused: '#7aa2f7', borderDim: '#1f2335',
    success: '#9ece6a', error: '#f7768e', warning: '#e0af68', info: '#7dcfff',
    diffAdded: '#9ece6a', diffRemoved: '#f7768e',
    diffAddedLineNumber: '#3a6a3a', diffRemovedLineNumber: '#6a3a3a',
    diffHeader: '#e0af68', diffHunk: '#bb9af7',
    mdHeading: '#7aa2f7', mdBold: '#e0e0e0', mdItalic: '#c0a0d0',
    mdCode: '#7dcfff', mdCodeFence: '#292e42', mdLink: '#7aa2f7',
    mdImage: '#bb9af7', mdBlockquote: '#565f89', mdBullet: '#7dcfff',
    mdOrdered: '#7dcfff', mdRule: '#292e42',
  },

  tokyonight: {
    name: 'tokyonight', label: 'Tokyonight',
    primary: '#7aa2f7', secondary: '#7dcfff', accent: '#bb9af7',
    text: '#c0caf5', textMuted: '#565f89', textEmphasized: '#e0e0e0',
    background: '#1a1b26', backgroundSecondary: '#1f2335', backgroundDarker: '#14141e',
    border: '#292e42', borderFocused: '#7aa2f7', borderDim: '#1f2335',
    success: '#9ece6a', error: '#f7768e', warning: '#e0af68', info: '#7dcfff',
    diffAdded: '#9ece6a', diffRemoved: '#f7768e',
    diffAddedLineNumber: '#3a6a3a', diffRemovedLineNumber: '#6a3a3a',
    diffHeader: '#e0af68', diffHunk: '#bb9af7',
    mdHeading: '#7aa2f7', mdBold: '#e0e0e0', mdItalic: '#c0a0d0',
    mdCode: '#7dcfff', mdCodeFence: '#292e42', mdLink: '#7aa2f7',
    mdImage: '#bb9af7', mdBlockquote: '#565f89', mdBullet: '#7dcfff',
    mdOrdered: '#7dcfff', mdRule: '#292e42',
  },

  catppuccin: {
    name: 'catppuccin', label: 'Catppuccin Mocha',
    primary: '#fab387', secondary: '#89b4fa', accent: '#cba6f7',
    text: '#cdd6f4', textMuted: '#6c7086', textEmphasized: '#f5f5f5',
    background: '#1e1e2e', backgroundSecondary: '#313244', backgroundDarker: '#181825',
    border: '#45475a', borderFocused: '#fab387', borderDim: '#313244',
    success: '#a6e3a1', error: '#f38ba8', warning: '#fab387', info: '#89dceb',
    diffAdded: '#a6e3a1', diffRemoved: '#f38ba8',
    diffAddedLineNumber: '#4a8a4a', diffRemovedLineNumber: '#8a4a4a',
    diffHeader: '#fab387', diffHunk: '#cba6f7',
    mdHeading: '#fab387', mdBold: '#f5f5f5', mdItalic: '#d5c4a1',
    mdCode: '#89dceb', mdCodeFence: '#45475a', mdLink: '#89b4fa',
    mdImage: '#cba6f7', mdBlockquote: '#6c7086', mdBullet: '#89dceb',
    mdOrdered: '#89dceb', mdRule: '#45475a',
  },

  gruvbox: {
    name: 'gruvbox', label: 'Gruvbox Dark',
    primary: '#fabd2f', secondary: '#83a598', accent: '#d3869b',
    text: '#ebdbb2', textMuted: '#928374', textEmphasized: '#f5f5f5',
    background: '#282828', backgroundSecondary: '#3c3836', backgroundDarker: '#1d2021',
    border: '#504945', borderFocused: '#fabd2f', borderDim: '#3c3836',
    success: '#b8bb26', error: '#fb4934', warning: '#fe8019', info: '#83a598',
    diffAdded: '#b8bb26', diffRemoved: '#fb4934',
    diffAddedLineNumber: '#4a6a2a', diffRemovedLineNumber: '#6a2a2a',
    diffHeader: '#fe8019', diffHunk: '#d3869b',
    mdHeading: '#fabd2f', mdBold: '#f5f5f5', mdItalic: '#d3869b',
    mdCode: '#83a598', mdCodeFence: '#504945', mdLink: '#83a598',
    mdImage: '#d3869b', mdBlockquote: '#928374', mdBullet: '#83a598',
    mdOrdered: '#83a598', mdRule: '#504945',
  },

  'one-dark': {
    name: 'one-dark', label: 'Atom One Dark',
    primary: '#e5c07b', secondary: '#61afef', accent: '#c678dd',
    text: '#abb2bf', textMuted: '#5c6370', textEmphasized: '#e0e0e0',
    background: '#282c34', backgroundSecondary: '#2c313a', backgroundDarker: '#21252b',
    border: '#3e4451', borderFocused: '#e5c07b', borderDim: '#2c313a',
    success: '#98c379', error: '#e06c75', warning: '#d19a66', info: '#56b6c2',
    diffAdded: '#98c379', diffRemoved: '#e06c75',
    diffAddedLineNumber: '#3a6a3a', diffRemovedLineNumber: '#6a3a3a',
    diffHeader: '#d19a66', diffHunk: '#c678dd',
    mdHeading: '#e5c07b', mdBold: '#e0e0e0', mdItalic: '#c678dd',
    mdCode: '#56b6c2', mdCodeFence: '#3e4451', mdLink: '#61afef',
    mdImage: '#c678dd', mdBlockquote: '#5c6370', mdBullet: '#56b6c2',
    mdOrdered: '#56b6c2', mdRule: '#3e4451',
  },

  nord: {
    name: 'nord', label: 'Nord',
    primary: '#88c0d0', secondary: '#81a1c1', accent: '#b48ead',
    text: '#eceff4', textMuted: '#4c566a', textEmphasized: '#f5f5f5',
    background: '#2e3440', backgroundSecondary: '#3b4252', backgroundDarker: '#242933',
    border: '#434c5e', borderFocused: '#88c0d0', borderDim: '#3b4252',
    success: '#a3be8c', error: '#bf616a', warning: '#d08770', info: '#88c0d0',
    diffAdded: '#a3be8c', diffRemoved: '#bf616a',
    diffAddedLineNumber: '#4a7a4a', diffRemovedLineNumber: '#7a4a4a',
    diffHeader: '#d08770', diffHunk: '#b48ead',
    mdHeading: '#88c0d0', mdBold: '#f5f5f5', mdItalic: '#b48ead',
    mdCode: '#88c0d0', mdCodeFence: '#434c5e', mdLink: '#81a1c1',
    mdImage: '#b48ead', mdBlockquote: '#4c566a', mdBullet: '#88c0d0',
    mdOrdered: '#88c0d0', mdRule: '#434c5e',
  },

  phosphor: {
    name: 'phosphor', label: 'Phosphor Green',
    primary: '#50fa7b', secondary: '#f1fa8c', accent: '#bd93f9',
    text: '#f8f8f2', textMuted: '#6272a4', textEmphasized: '#ffffff',
    background: '#1a1a2e', backgroundSecondary: '#222240', backgroundDarker: '#12122a',
    border: '#44475a', borderFocused: '#50fa7b', borderDim: '#222240',
    success: '#50fa7b', error: '#ff5555', warning: '#f1fa8c', info: '#8be9fd',
    diffAdded: '#50fa7b', diffRemoved: '#ff5555',
    diffAddedLineNumber: '#2a6a3a', diffRemovedLineNumber: '#6a2a2a',
    diffHeader: '#f1fa8c', diffHunk: '#bd93f9',
    mdHeading: '#50fa7b', mdBold: '#ffffff', mdItalic: '#f1fa8c',
    mdCode: '#8be9fd', mdCodeFence: '#44475a', mdLink: '#50fa7b',
    mdImage: '#bd93f9', mdBlockquote: '#6272a4', mdBullet: '#8be9fd',
    mdOrdered: '#8be9fd', mdRule: '#44475a',
  },

  light: {
    name: 'light', label: 'Light',
    primary: '#0550ae', secondary: '#0969da', accent: '#8250df',
    text: '#24292f', textMuted: '#656d76', textEmphasized: '#1a1a1a',
    background: '#ffffff', backgroundSecondary: '#f6f8fa', backgroundDarker: '#f0f0f0',
    border: '#d0d7de', borderFocused: '#0550ae', borderDim: '#e8ecf0',
    success: '#1a7f37', error: '#cf222e', warning: '#9a6700', info: '#0969da',
    diffAdded: '#1a7f37', diffRemoved: '#cf222e',
    diffAddedLineNumber: '#2a8a2a', diffRemovedLineNumber: '#8a2a2a',
    diffHeader: '#9a6700', diffHunk: '#8250df',
    mdHeading: '#0550ae', mdBold: '#1a1a1a', mdItalic: '#656d76',
    mdCode: '#0969da', mdCodeFence: '#d0d7de', mdLink: '#0969da',
    mdImage: '#8250df', mdBlockquote: '#656d76', mdBullet: '#0969da',
    mdOrdered: '#0969da', mdRule: '#d0d7de',
  },
};

export function getTheme(name?: string): Theme {
  return (name && THEMES[name]) || THEMES.octapus;
}

export function listThemeNames(): string[] {
  return Object.keys(THEMES);
}
