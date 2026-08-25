import marked from 'marked';
import markedTerminal from 'marked-terminal';
import chalk from 'chalk';

function configure(width: number): void {
  // Types for marked v4 don't declare .use on the callable export; runtime has it.
  (marked as any).use(
    markedTerminal({
      reflowText: true,
      width,
      emoji: true,
      // Style overrides for a modern look
      heading: chalk.bold.cyan,
      code: chalk.yellow,
      codespan: chalk.bgBlack.cyan,
      firstHeading: chalk.bold.magenta,
      link: chalk.blue.underline,
      href: chalk.gray,
      table: chalk.white,
      strong: chalk.bold.white,
      em: chalk.italic.white,
      blockquote: chalk.gray.italic,
      bullet: chalk.cyan('•'),
      quote: chalk.gray('│')
    }) as any
  );
}

let configuredWidth = 0;

/**
 * Render markdown text as styled terminal output.
 * Re-configures when terminal width changes; falls back to plain text on parse errors.
 */
export function renderMarkdown(text: string): string {
  try {
    const width = Math.max(60, (process.stdout.columns || 100) - 6);
    if (width !== configuredWidth) {
      configure(width);
      configuredWidth = width;
    }
    // marked v4 runtime exposes both call signature and .parse; types are
    // inconsistent across versions, so bypass strict typing for this call.
    const out = (marked as any)(text, { async: false }) as unknown;
    return typeof out === 'string' ? out.trimEnd() : text;
  } catch {
    return text;
  }
}
