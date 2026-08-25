import * as fs from 'fs';
import * as path from 'path';

export interface CustomCommand {
  name: string;
  description: string;
  template: string;
  /** $ARGUMENTS placeholder present? */
  takesArguments: boolean;
}

const USER_COMMANDS_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '',
  '.config', 'octapus', 'commands'
);

/**
 * Load custom slash commands from markdown files.
 * ~/.config/octapus/commands/review.md becomes /review
 *
 * Frontmatter: description (optional). Body = prompt template with
 * $ARGUMENTS substituted by everything typed after the command.
 */
export function loadCustomCommands(): CustomCommand[] {
  const out: CustomCommand[] = [];
  try {
    if (!fs.existsSync(USER_COMMANDS_DIR)) return out;
    for (const f of fs.readdirSync(USER_COMMANDS_DIR)) {
      if (!f.endsWith('.md')) continue;
      try {
        const raw = fs.readFileSync(path.join(USER_COMMANDS_DIR, f), 'utf8').replace(/^\uFEFF/, '');
        const name = f.replace(/\.md$/, '').toLowerCase();
        let description = '';
        let body = raw;
        const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (fm) {
          const dm = fm[1].match(/^description:\s*"?(.+?)"?\s*$/m);
          if (dm) description = dm[1].trim();
          body = raw.slice(fm[0].length).trim();
        }
        if (!body) continue;
        out.push({ name, description, template: body, takesArguments: body.includes('$ARGUMENTS') });
      } catch {
        continue;
      }
    }
  } catch {
    // ignore
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Expand a custom command into the final prompt.
 *  Function replacer prevents $&/$`/$$ metacharacters in user args
 *  from being interpreted as replacement patterns. */
export function expandCommand(cmd: CustomCommand, args: string): string {
  return cmd.takesArguments
    ? cmd.template.replace(/\$ARGUMENTS/g, () => args)
    : cmd.template;
}
