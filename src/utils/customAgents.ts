import * as fs from 'fs';
import * as path from 'path';

export interface CustomAgent {
  name: string;
  description: string;
  model?: string;
  temperature?: number;
  role?: string;
  systemPrompt: string;
  source: string;
}

const USER_AGENTS_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '',
  '.config', 'octapus', 'agents'
);
const BUNDLED_AGENTS_DIR = path.join(__dirname, '..', '..', 'agents');

/**
 * Load custom agent definitions from markdown files.
 * Format (OpenCode-compatible):
 * ---
 * description: when to use this agent
 * model: provider-model-id (optional override)
 * temperature: 0.1
 * role: coder|security|general|fast (optional routing hint)
 * ---
 * <body becomes the system prompt>
 */
function parseAgentFile(filePath: string, source: string): CustomAgent | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    const fm = raw.match(/^(?:<!--[\s\S]*?-->\s*)?---\r?\n([\s\S]*?)\r?\n---/);
    let description = '';
    let model: string | undefined;
    let temperature: number | undefined;
    let role: string | undefined;

    if (fm) {
      const front = fm[1];
      const get = (k: string): string | undefined => {
        const m = front.match(new RegExp(`^${k}:\\s*"?(.+?)"?\\s*$`, 'm'));
        return m ? m[1].trim() : undefined;
      };
      description = get('description') || '';
      model = get('model');
      const t = get('temperature');
      if (t) temperature = parseFloat(t);
      role = get('role');
    }

    const body = raw.replace(/^(?:<!--[\s\S]*?-->\s*)?---\r?\n[\s\S]*?\r?\n---/, '').trim();
    if (!body) return null;

    const name = path.basename(filePath, '.md');
    return { name, description, model, temperature, role, systemPrompt: body, source };
  } catch {
    return null;
  }
}

/** List all custom agents (user dir overrides bundled). Hot-reloads every call. */
export function listCustomAgents(): CustomAgent[] {
  const byName = new Map<string, CustomAgent>();
  for (const [dir, source] of [[BUNDLED_AGENTS_DIR, 'bundled'] as const, [USER_AGENTS_DIR, 'user'] as const]) {
    try {
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.md')) continue;
        const a = parseAgentFile(path.join(dir, f), source);
        if (a) byName.set(a.name, a);
      }
    } catch {
      continue;
    }
  }
  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function getCustomAgent(name: string): CustomAgent | undefined {
  return listCustomAgents().find((a) => a.name === name);
}
