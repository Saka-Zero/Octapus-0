import * as fs from 'fs';
import * as path from 'path';

export interface Skill {
  name: string;
  description: string;
  keywords: string[];
  /** True when keywords came from explicit frontmatter (high-trust matching) */
  hasExplicitKeywords: boolean;
  content: string;
  source: 'user' | 'bundled';
}

const USER_SKILLS_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '',
  '.config', 'octapus', 'skills'
);
// dist/utils/skills.js -> repo/skills
const BUNDLED_SKILLS_DIR = path.join(__dirname, '..', '..', 'skills');

const MAX_SKILL_INJECT_CHARS = 4000;

/**
 * Parse YAML-ish frontmatter (name/description/keywords) from a SKILL.md file.
 */
function parseSkillFile(filePath: string, source: 'user' | 'bundled'): Skill | null {
  try {
    // Strip BOM (PowerShell 5.1 writes UTF-8 with BOM) then parse frontmatter,
    // which may be preceded by an attribution comment block
    const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    const fmMatch = raw.match(/^(?:<!--[\s\S]*?-->\s*)?---\r?\n([\s\S]*?)\r?\n---/);
    let name = path.basename(path.dirname(filePath));
    let description = '';
    let explicitKeywords: string[] = [];

    if (fmMatch) {
      const fm = fmMatch[1];
      const nameM = fm.match(/^name:\s*(.+)$/m);
      if (nameM) name = nameM[1].trim();
      const descM = fm.match(/^description:\s*"?(.+?)"?\s*$/m);
      if (descM) description = descM[1].trim();
      const kwM = fm.match(/^keywords:\s*(.+)$/m);
      if (kwM) {
        explicitKeywords = kwM[1].split(',').map((k) => k.trim().toLowerCase()).filter(Boolean);
      }
    }

    // Derive keywords: explicit > name parts > significant description words
    const nameParts = name.toLowerCase().split(/[-_\s]+/).filter((w) => w.length > 2);
    const descWords = description
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 4);
    const hasExplicit = explicitKeywords.length > 0;
    const keywords = hasExplicit
      ? explicitKeywords
      : [...new Set([...nameParts, ...descWords.slice(0, 25)])];

    return { name, description, keywords, hasExplicitKeywords: hasExplicit, content: raw, source };
  } catch {
    return null;
  }
}

/**
 * Ensure the user skills dir exists (seeded from bundled skills on first run).
 */
function ensureUserSkillsDir(): void {
  if (!fs.existsSync(USER_SKILLS_DIR)) {
    fs.mkdirSync(USER_SKILLS_DIR, { recursive: true });
    // Seed from bundled skills so users can edit their copies
    try {
      if (fs.existsSync(BUNDLED_SKILLS_DIR)) {
        for (const dir of fs.readdirSync(BUNDLED_SKILLS_DIR)) {
          const src = path.join(BUNDLED_SKILLS_DIR, dir, 'SKILL.md');
          if (!fs.existsSync(src)) continue;
          const dstDir = path.join(USER_SKILLS_DIR, dir);
          fs.mkdirSync(dstDir, { recursive: true });
          fs.copyFileSync(src, path.join(dstDir, 'SKILL.md'));
        }
      }
    } catch {
      // Non-fatal — bundled skills still work as fallback
    }
  }
}

// Cache keyed by directory mtimes — avoids re-reading every SKILL.md on
// every prompt (hot path). Edits to skills still picked up via mtime change.
let cacheKey = '';
let cachedSkills: Skill[] | null = null;

function dirSignature(): string {
  const sigs: string[] = [];
  for (const dir of [USER_SKILLS_DIR, BUNDLED_SKILLS_DIR]) {
    try {
      if (!fs.existsSync(dir)) { sigs.push('none'); continue; }
      const stat = fs.statSync(dir);
      // Per-FILE mtimes so content edits invalidate the cache too
      const files = fs
        .readdirSync(dir)
        .map((f) => {
          try { return `${f}:${fs.statSync(path.join(dir, f)).mtimeMs}`; } catch { return f; }
        })
        .join(',');
      sigs.push(`${dir}:${stat.mtimeMs}:${files}`);
    } catch { sigs.push(`${dir}:err`); }
  }
  return sigs.join('|');
}

/**
 * List all available skills. User-dir skills override bundled ones with the same name.
 * Cached per directory mtime — hot-reloads when skill files/dirs change.
 */
export function listSkills(): Skill[] {
  ensureUserSkillsDir();
  const key = dirSignature();
  if (cachedSkills && key === cacheKey) return cachedSkills;

  const byName = new Map<string, Skill>();

  for (const [dir, source] of [[BUNDLED_SKILLS_DIR, 'bundled'] as const, [USER_SKILLS_DIR, 'user'] as const]) {
    try {
      if (!fs.existsSync(dir)) continue;
      for (const entry of fs.readdirSync(dir)) {
        const skillPath = path.join(dir, entry, 'SKILL.md');
        if (!fs.existsSync(skillPath)) continue;
        const skill = parseSkillFile(skillPath, source);
        if (skill) byName.set(skill.name, skill); // later source wins (user > bundled)
      }
    } catch {
      // skip unreadable dirs
    }
  }

  cachedSkills = Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
  cacheKey = key;
  return cachedSkills;
}

/**
 * Match skills against a user prompt. Returns top-N skills sorted by relevance score.
 * Uses prefix-fuzzy matching so "debug" hits "debugging", "pentest" hits "pentesting".
 */
export function matchSkills(prompt: string, maxSkills = 2): Skill[] {
  const query = prompt.toLowerCase();
  const queryTokens = Array.from(new Set(query.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)));

  // Light English stemming: bugs→bug, tests→test, vulnerabilities→vulnerability
  const stem = (w: string): string =>
    w.length > 4 ? w.replace(/ies$/, 'y').replace(/([a-z])s$/, '$1') : w;

  const tokenHits = (kw: string): boolean => {
    if (kw.includes(' ')) return query.includes(kw);
    const nk = stem(kw);
    if (queryTokens.some((t) => t === nk || stem(t) === nk)) return true;
    // Prefix fuzzy only for substantial keywords — prevents "TesterBudi"
    // from activating the "test" skill via substring coincidence
    if (kw.length < 6) return false;
    return queryTokens.some((t) => t.length >= 5 && t.length <= 16 && (t.startsWith(kw) || kw.startsWith(t)));
  };

  const scored: Array<{ skill: Skill; score: number }> = [];
  for (const skill of listSkills()) {
    let score = 0;
    if (skill.hasExplicitKeywords) {
      // High-trust curated keywords: one solid hit is enough
      for (const kw of skill.keywords) {
        if (tokenHits(kw)) score += kw.includes(' ') ? 4 : 3;
      }
    } else {
      // Derived keywords (name/description): require broader evidence
      for (const kw of skill.keywords) {
        if (tokenHits(kw)) score += kw.length > 6 ? 2 : 1;
      }
    }
    if (score >= 2) {
      scored.push({ skill, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxSkills).map((s) => s.skill);
}

/**
 * Format matched skills for injection into the system prompt.
 */
export function formatSkillsForPrompt(skills: Skill[]): string {
  if (skills.length === 0) return '';
  return skills
    .map((s) => {
      let body = s.content;
      // Strip frontmatter from injected body
      body = body.replace(/^---\r?\n[\s\S]*?\r?\n---/, '').trim();
      if (body.length > MAX_SKILL_INJECT_CHARS) {
        body = body.slice(0, MAX_SKILL_INJECT_CHARS) + '\n… (skill truncated — apply the methodology above)';
      }
      return `[Active skill: ${s.name}]\n${body}`;
    })
    .join('\n\n');
}
