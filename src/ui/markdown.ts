import chalk from 'chalk';
import { Theme } from './theme';

/**
 * Hand-rolled markdown → terminal renderer.
 * Faithfully mirrors OpenCode's glamour-based renderer behavior:
 *   - Blockquote prefix: "┃ " (from OpenCode markdown.go)
 *   - List bullet: "•"
 *   - Code fence: "╭─ lang ───────╮ / │ / ╰─╯"
 *   - Color tokens from Theme's md* fields
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ChalkFn = (...args: any[]) => string;

let _heading: ChalkFn = chalk.bold;
let _bold: ChalkFn = chalk.bold;
let _italic: ChalkFn = chalk.italic;
let _code: ChalkFn = chalk.cyan;
let _codeFence: ChalkFn = chalk.gray;
let _link: ChalkFn = chalk.blue.underline;
let _image: ChalkFn = chalk.magenta;
let _blockquote: ChalkFn = chalk.gray;
let _bullet: ChalkFn = chalk.cyan;
let _ordered: ChalkFn = chalk.cyan;
let _rule: ChalkFn = chalk.gray;
let _lastKey = '';

function ensureChalks(theme: Theme): void {
  const key = `${theme.name}-${theme.primary}`;
  if (key === _lastKey) return;
  _lastKey = key;
  try {
    _heading = chalk.hex(theme.mdHeading).bold;
    _bold = chalk.hex(theme.mdBold).bold;
    _italic = chalk.hex(theme.mdItalic).italic;
    _code = chalk.hex(theme.mdCode);
    _codeFence = chalk.hex(theme.mdCodeFence);
    _link = chalk.hex(theme.mdLink).underline;
    _image = chalk.hex(theme.mdImage);
    _blockquote = chalk.hex(theme.mdBlockquote).italic;
    _bullet = chalk.hex(theme.mdBullet);
    _ordered = chalk.hex(theme.mdOrdered);
    _rule = chalk.hex(theme.mdRule);
  } catch {
    // fallback if hex parsing fails
  }
}

/** Inline transforms: bold, italic, code, links, strikethrough */
function inline(s: string): string {
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, _image('🖼 $1'));
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, _link('$1'));
  // Two passes so adjacent/nested emphasis pairs resolve cleanly
  for (let i = 0; i < 2; i++) {
    s = s.replace(/\*\*\*([^*]+?)\*\*\*/g, _bold(_italic('$1')));
    s = s.replace(/\*\*([^*]+?)\*\*/g, _bold('$1'));
    s = s.replace(/__([^_]+?)__/g, _bold('$1'));
    s = s.replace(/(^|[\s(])\*([^*\n]+?)\*/g, '$1' + _italic('$2'));
    s = s.replace(/(^|[\s(])_([^_\n]+?)_/g, '$1' + _italic('$2'));
    s = s.replace(/~~([^~]+?)~~/g, chalk.strikethrough('$1'));
  }
  // inline code LAST so ** inside `code` doesn't get double-processed badly
  s = s.replace(/`([^`]+)`/g, _code('$1'));
  // Strip any orphan emphasis markers left over (malformed markdown)
  s = s.replace(/\*\*(?=\S)/g, '').replace(/(?<=\S)\*\*/g, '');
  return s;
}

export function renderMarkdown(text: string, opts?: { theme?: Theme; accent?: string; muted?: string }): string {
  // Accept full Theme or legacy accent/muted
  const theme = opts?.theme;
  if (theme) ensureChalks(theme);

  const width = Math.max(40, Math.min(process.stdout.columns || 100, 120));
  const lines = text.split('\n');
  const out: string[] = [];
  let inCode = false;
  let codeLang = '';
  let codeBuf: string[] = [];

  const flushCode = (): void => {
    // OpenCode style: thin box-drawing frame around code
    const langLabel = codeLang ? ` ${codeLang} ` : '';
    const pad = Math.max(4, width - codeLang.length - 6);
    out.push(_codeFence(`╭─${langLabel}${'─'.repeat(pad)}╮`));
    for (const l of codeBuf.slice(0, 200)) {
      out.push(_codeFence('│ ') + l);
    }
    if (codeBuf.length > 200) out.push(_codeFence(`│ … ${codeBuf.length - 200} more lines`));
    out.push(_codeFence('╰' + '─'.repeat(width - 2) + '╯'));
    codeBuf = [];
  };

  for (const raw of lines) {
    const fence = raw.match(/^\s*```\s*(\S*)/);
    if (fence) {
      if (!inCode) {
        inCode = true;
        codeLang = fence[1] || '';
        codeBuf = [];
      } else {
        inCode = false;
        flushCode();
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(raw);
      continue;
    }

    // Horizontal rule
    if (/^\s*([-*_])\s*\1\s*\1[\s-*_]*$/.test(raw)) {
      out.push(_rule('─'.repeat(Math.min(width, 60))));
      continue;
    }

    // Headings
    const h = raw.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const body = inline(h[2]);
      if (level <= 2) out.push('', _heading(body), _rule('─'.repeat(Math.min(width, 40))));
      else out.push('', _heading(body));
      continue;
    }

    // Blockquote — OpenCode uses "┃ " prefix (glamour default)
    const bq = raw.match(/^\s*>\s?(.*)$/);
    if (bq) {
      out.push(_blockquote('┃ ') + inline(bq[1]));
      continue;
    }

    // Unordered list
    const ul = raw.match(/^(\s*)[-*+]\s+(.*)$/);
    if (ul) {
      out.push(ul[1] + _bullet('• ') + inline(ul[2]));
      continue;
    }

    // Ordered list
    const ol = raw.match(/^(\s*)(\d+)\.\s*(.*)$/);
    if (ol) {
      out.push(`${ol[1]}${_ordered(ol[2] + '.')} ${inline(ol[3])}`);
      continue;
    }

    out.push(inline(raw));
  }

  if (inCode && codeBuf.length) flushCode(); // unclosed fence

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}
