import * as fs from 'fs';
import * as path from 'path';

const MEMORY_FILE = path.join(
  process.env.HOME || process.env.USERPROFILE || '',
  '.config', 'octapus', 'memory.json'
);

export interface MemoryEntry {
  key: string;
  value: string;
  updatedAt: string;
  source: 'auto' | 'manual';
}

interface MemoryFile {
  version: number;
  entries: Record<string, MemoryEntry>;
}

const EMPTY_MEMORY: MemoryFile = { version: 1, entries: {} };

/**
 * Load the persistent memory store
 */
export function loadMemory(): MemoryFile {
  try {
    if (!fs.existsSync(MEMORY_FILE)) return { ...EMPTY_MEMORY, entries: {} };
    const data = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8')) as MemoryFile;
    if (!data.entries || typeof data.entries !== 'object') return { ...EMPTY_MEMORY, entries: {} };
    return data;
  } catch {
    return { ...EMPTY_MEMORY, entries: {} };
  }
}

/**
 * Save the persistent memory store
 */
function saveMemory(memory: MemoryFile): void {
  const dir = path.dirname(MEMORY_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2), { mode: 0o600 });
}

/**
 * Store or update a fact. Returns true if it's new knowledge.
 */
export function rememberFact(key: string, value: string, source: 'auto' | 'manual' = 'manual'): boolean {
  const memory = loadMemory();
  const normalizedKey = key.trim().toLowerCase().replace(/\s+/g, '.');
  const existing = memory.entries[normalizedKey];
  const isNew = !existing || existing.value !== value;

  memory.entries[normalizedKey] = {
    key: normalizedKey,
    value,
    updatedAt: new Date().toISOString(),
    source
  };
  saveMemory(memory);
  return isNew;
}

/**
 * Remove a fact by key. Returns true if it existed.
 */
export function forgetFact(key: string): boolean {
  const memory = loadMemory();
  const normalizedKey = key.trim().toLowerCase().replace(/\s+/g, '.');
  if (!memory.entries[normalizedKey]) return false;
  delete memory.entries[normalizedKey];
  saveMemory(memory);
  return true;
}

/**
 * Get all stored facts sorted by most recently updated
 */
export function getAllFacts(): MemoryEntry[] {
  return Object.values(loadMemory().entries)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

/**
 * Format all facts as a compact block for injection into the system prompt
 */
export function formatMemoryForPrompt(maxEntries = 30): string {
  const facts = getAllFacts().slice(0, maxEntries);
  if (facts.length === 0) return '';
  const lines = facts.map(f => `- ${f.key}: ${f.value}`);
  return `[Long-term memory about the user — always apply this context]\n${lines.join('\n')}`;
}

// ─── Auto-learning: fact extraction from user messages ───────────────

interface ExtractionRule {
  pattern: RegExp;
  key: string | ((m: RegExpMatchArray) => string);
  value: (m: RegExpMatchArray) => string;
}

const EXTRACTION_RULES: ExtractionRule[] = [
  // Name: "my name is Saka", "call me Saka" — trigger phrase case-insensitive,
  // captured name must start with a capital letter ([A-Z] kept strict)
  {
    pattern: /\b(?:[Mm]y [Nn]ame [Ii]s|[Cc]all [Mm]e)\s+([A-Z][a-zA-Z0-9_-]{1,30})\b/,
    key: 'user.name',
    value: (m) => m[1]
  },
  // Explicit memory: "remember that X", "remember: X", "note that X"
  {
    pattern: /\b(?:remember|note)(?:\s+that|:)\s+(.{5,300})/i,
    key: (m) => {
      const text = m[1].trim();
      // Use first few words as key for lookupability
      const words = text.split(/\s+/).slice(0, 4).join('-').toLowerCase().replace(/[^a-z0-9-]/g, '');
      return `note.${words || 'misc'}`;
    },
    value: (m) => m[1].trim()
  },
  // Preference: "I prefer X", "I like using X" — stable slug key so similar
  // preferences overwrite instead of piling up duplicates
  {
    pattern: /\bI\s+(?:prefer|like\s+using|always\s+use)\s+(.{3,150})/i,
    key: (m) => `preference.${slugify(m[1])}`,
    value: (m) => m[1].trim()
  },
  // Project context: "I'm working on X", "my project is X"
  {
    pattern: /\b(?:I'?m working on|my project is)\s+(.{3,150})/i,
    key: () => 'project.current',
    value: (m) => m[1].trim()
  }
];

/**
 * Stable slug from free text (first few meaningful words).
 */
function slugify(text: string): string {
  const words = text.trim().split(/\s+/).slice(0, 4).join('-').toLowerCase().replace(/[^a-z0-9-]/g, '');
  return words || 'misc';
}

/**
 * Extract facts from a user message and store them.
 * Returns list of keys that were learned/updated.
 */
export function learnFromMessage(message: string): string[] {
  const learned: string[] = [];

  for (const rule of EXTRACTION_RULES) {
    const match = message.match(rule.pattern);
    if (!match) continue;

    const key = typeof rule.key === 'function' ? rule.key(match) : rule.key;
    const value = rule.value(match).replace(/\s+/g, ' ').trim();
    if (!value) continue;

    // For user.name, don't overwrite an explicitly-set manual entry with auto detection noise
    if (key === 'user.name' && message.toLowerCase().includes('my name is')) {
      rememberFact(key, value, 'auto');
      learned.push(key);
      continue;
    }

    if (rememberFact(key, value, 'auto')) {
      learned.push(key);
    }
  }

  return learned;
}
