import chalk from 'chalk';

/**
 * Hand-rolled markdown → terminal renderer.
 * Zero dependencies, full control, always consistent.
 * Follows OpenCode aesthetic: colored headings, clean bullets,
 * framed code blocks, proper emphasis.
 */

export interface RenderOptions {
  /** Accent color for headings (hex string) */
  accent?: string;
  /** Muted color for rules/code frames */
  muted?: string;
}

let cachedAccent = '';
let cachedMuted = '';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let headingChalk: any = chalk.bold;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let frameChalk: any = chalk.gray;

function ensureChalks(accent?: string, muted?: string): void {
  const a = accent || '#7aa2f7';
  const m = muted || '#565f89';
  if (a === cachedAccent && m === cachedMuted) return;
  cachedAccent = a;
  cachedMuted = m;
  try {
    headingChalk = chalk.hex(a).bold;
    frameChalk = chalk.hex(m);
  } catch {
    headingChalk = chalk.bold;
    frameChalk = chalk.gray;
  }
}

/** Inline transforms: bold, italic, code, links, strikethrough */
function inline(s: string): string {
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, chalk.gray('🖼 $1'));
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, chalk.blue.underline('$1'));
  s = s.replace(/\*\*\*([^*]+)\*\*\*/g, chalk.bold.italic('$1'));
  s = s.replace(/\*\*([^*]+)\*\*/g, chalk.bold('$1'));
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1' + chalk.italic('$2'));
  s = s.replace(/(^|[\s(])_([^_\n]+)_/g, '$1' + chalk.italic('$2'));
  s = s.replace(/~~([^~]+)~~/g, chalk.strikethrough('$1'));
  // inline code LAST so ** inside `code` doesn't get double-processed badly
  s = s.replace(/`([^`]+)`/g, chalk.cyan('$1'));
  return s;
}

export function renderMarkdown(text: string, opts?: RenderOptions): string {
  ensureChalks(opts?.accent, opts?.muted);

  const width = Math.max(40, Math.min(process.stdout.columns || 100, 120));
  const lines = text.split('\n');
  const out: string[] = [];
  let inCode = false;
  let codeLang = '';
  let codeBuf: string[] = [];

  const flushCode = (): void => {
    out.push(frameChalk(`╭─${codeLang ? ' ' + codeLang + ' ' : ''}${'─'.repeat(Math.max(4, width - codeLang.length - 6))}╮`));
    for (const l of codeBuf.slice(0, 200)) {
      out.push(frameChalk('│ ') + l);
    }
    if (codeBuf.length > 200) out.push(frameChalk(`│ … ${codeBuf.length - 200} more lines`));
    out.push(frameChalk('╰' + '─'.repeat(width - 2) + '╯'));
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
      out.push(frameChalk('─'.repeat(Math.min(width, 60))));
      continue;
    }

    // Headings
    const h = raw.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const body = inline(h[2]);
      if (level <= 2) out.push('', headingChalk(body), frameChalk('─'.repeat(Math.min(width, 40))));
      else out.push('', headingChalk(body));
      continue;
    }

    // Blockquote
    const bq = raw.match(/^\s*>\s?(.*)$/);
    if (bq) {
      out.push(frameChalk('▌ ') + chalk.italic(inline(bq[1])));
      continue;
    }

    // Unordered list
    const ul = raw.match(/^(\s*)[-*+]\s+(.*)$/);
    if (ul) {
      out.push(ul[1] + chalk.cyan('• ') + inline(ul[2]));
      continue;
    }

    // Ordered list
    const ol = raw.match(/^(\s*)(\d+)\.\s+(.*)$/);
    if (ol) {
      out.push(`${ol[1]}${chalk.cyan(ol[2] + '.')} ${inline(ol[3])}`);
      continue;
    }

    out.push(inline(raw));
  }

  if (inCode && codeBuf.length) flushCode(); // unclosed fence

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}
