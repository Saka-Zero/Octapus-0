import * as fs from 'fs';
import * as path from 'path';

/**
 * Focus Chain (Cline pattern): a persisted markdown todo checklist that the
 * agent maintains during long tasks. Stored OUTSIDE the conversation so it
 * survives compaction/digests, and re-injected periodically so the agent
 * never loses track of multi-step work.
 */

const FOCUS_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '',
  '.config', 'octapus', 'focus'
);

function chainFile(sessionId: string): string {
  const safe = sessionId.replace(/[^A-Za-z0-9_-]/g, '_');
  return path.join(FOCUS_DIR, `${safe}.md`);
}

export function getFocusChain(sessionId: string): string | null {
  try {
    if (!fs.existsSync(chainFile(sessionId))) return null;
    return fs.readFileSync(chainFile(sessionId), 'utf8');
  } catch {
    return null;
  }
}

export function setFocusChain(sessionId: string, content: string): void {
  try {
    fs.mkdirSync(FOCUS_DIR, { recursive: true });
    fs.writeFileSync(chainFile(sessionId), content);
  } catch {
    // best-effort
  }
}

export function clearFocusChain(sessionId: string): void {
  try {
    if (fs.existsSync(chainFile(sessionId))) fs.unlinkSync(chainFile(sessionId));
  } catch {}
}

/** Parse "- [x] item" style lines into structured entries */
export function parseChainItems(content: string): Array<{ text: string; done: boolean }> {
  return content
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- ['))
    .map((l) => ({
      done: l.startsWith('- [x]') || l.startsWith('- [X]'),
      text: l.replace(/^-\s*\[.\]\s*/, '')
    }));
}
