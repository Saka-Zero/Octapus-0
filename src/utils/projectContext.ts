import * as fs from 'fs';
import * as path from 'path';

const MAX_CONTEXT_CHARS = 16000;
const CONTEXT_FILES = ['OCTAPUS.md', 'AGENTS.md', 'CLAUDE.md'];

/**
 * Load per-project instruction context (CLAUDE.md pattern).
 * Walks from cwd up to filesystem root; first match wins per level.
 * Supports OCTAPUS.md, AGENTS.md and CLAUDE.md for ecosystem interop.
 */
export function loadProjectContext(cwd: string = process.cwd()): { path: string; content: string } | null {
  let dir = path.resolve(cwd);
  const root = path.parse(dir).root;

  while (true) {
    for (const name of CONTEXT_FILES) {
      const p = path.join(dir, name);
      try {
        if (!fs.existsSync(p)) continue;
        const stat = fs.statSync(p);
        if (!stat.isFile() || stat.size > 512 * 1024) continue;
        let content = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
        if (content.length > MAX_CONTEXT_CHARS) {
          content = content.slice(0, MAX_CONTEXT_CHARS) + '\n… (truncated)';
        }
        return { path: p, content };
      } catch {
        continue;
      }
    }
    if (dir === root) break;
    dir = path.dirname(dir);
  }
  return null;
}

/**
 * Formatted block for injection into the system prompt.
 */
export function formatProjectContext(): string {
  const ctx = loadProjectContext();
  if (!ctx || !ctx.content.trim()) return '';
  return `[Project instructions from ${ctx.path} — follow these for this workspace]\n${ctx.content}`;
}
