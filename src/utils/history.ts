import * as fs from 'fs';
import * as path from 'path';
import { Message } from '../providers';
import chalk from 'chalk';

const HISTORY_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '', '.config', 'octapus', 'history');
const MAX_HISTORY_MESSAGES = 100; // Hard cap on messages kept in context
const MAX_HISTORY_FILES = 20; // Max conversation files to keep
const CONTEXT_CHAR_BUDGET = 48000; // ~14k tokens of conversation history (excl. system prompt)

export interface ConversationSession {
  id: string;
  startedAt: Date;
  lastActive: Date;
  model: string;
  messages: Message[];
  title: string;
  /** Rolling AI-generated summary of turns that fell out of the context window.
   *  Full messages are ALWAYS kept on disk — this only compresses what gets sent to the API. */
  digest?: string;
}

/**
 * Generate a short session ID from timestamp + random suffix (collision-safe)
 */
function generateSessionId(): string {
  const now = new Date();
  const rand = Math.random().toString(36).slice(2, 6);
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}_${rand}`;
}

/**
 * Ensure history directory exists
 */
function ensureHistoryDir(): void {
  if (!fs.existsSync(HISTORY_DIR)) {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
  }
}

/**
 * Get the current session file path
 */
function getSessionPath(sessionId?: string): string {
  if (sessionId) {
    return path.join(HISTORY_DIR, `${sessionId}.json`);
  }
  // No ID given — find the most recently active session
  const latest = getLatestSessionId();
  return path.join(HISTORY_DIR, `${latest}.json`);
}

/**
 * Find the most recently active session ID
 */
function getLatestSessionId(): string | null {
  ensureHistoryDir();
  try {
    const files = fs.readdirSync(HISTORY_DIR)
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse();
    
    if (files.length === 0) return null;
    return files[0].replace('.json', '');
  } catch {
    return null;
  }
}

/**
 * Load a conversation session
 */
export function loadSession(sessionId?: string): ConversationSession | null {
  ensureHistoryDir();
  const filePath = getSessionPath(sessionId);
  
  if (!fs.existsSync(filePath)) {
    return null;
  }
  
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    const session = JSON.parse(data) as ConversationSession;
    session.startedAt = new Date(session.startedAt);
    session.lastActive = new Date(session.lastActive);
    return session;
  } catch {
    return null;
  }
}

/**
 * Save a conversation session (atomic: tmp + rename prevents torn files
 * when two processes or a crash interrupt the write).
 */
export function saveSession(session: ConversationSession): void {
  ensureHistoryDir();
  const filePath = getSessionPath(session.id);
  const tmp = filePath + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(session, null, 2));
  fs.renameSync(tmp, filePath);
  cleanupOldSessions();
}

/**
 * Create a new conversation session
 */
export function createSession(model: string, systemPrompt?: string): ConversationSession {
  const session: ConversationSession = {
    id: generateSessionId(),
    startedAt: new Date(),
    lastActive: new Date(),
    model,
    messages: [],
    title: 'New conversation'
  };
  
  if (systemPrompt) {
    session.messages.push({ role: 'system', content: systemPrompt });
  }
  
  return session;
}

/**
 * Add a message to the session
 */
export function addMessage(session: ConversationSession, role: 'user' | 'assistant', content: string): void {
  session.messages.push({ role, content });
  session.lastActive = new Date();
  
  // Auto-generate title from first user message
  if (role === 'user' && session.messages.filter(m => m.role === 'user').length === 1) {
    session.title = content.slice(0, 50) + (content.length > 50 ? '...' : '');
  }
  
  saveSession(session);
}

/**
 * Split conversation history into (kept, overflow) given the context budget.
 * Kept = most recent messages that fit; overflow = older turns outside the window.
 */
function splitByBudget(historyMessages: Message[]): { kept: Message[]; overflow: Message[] } {
  const recentMessages = historyMessages.slice(-MAX_HISTORY_MESSAGES);

  const kept: Message[] = [];
  let used = 0;
  for (let i = recentMessages.length - 1; i >= 0; i--) {
    const len = recentMessages[i].content.length;
    if (used + len > CONTEXT_CHAR_BUDGET && kept.length > 0) break;
    kept.unshift(recentMessages[i]);
    used += len;
  }

  const keptSet = new Set(kept);
  const overflow = historyMessages.filter((m) => !keptSet.has(m));
  return { kept, overflow };
}

/**
 * Get messages for API call (with context window management).
 * When old turns fall out of the window, the session's rolling digest is
 * injected so earlier context is never fully lost.
 */
export function getMessagesForApi(session: ConversationSession, newPrompt?: string): Message[] {
  const messages: Message[] = [];
  
  // Add system message if present
  const systemMsg = session.messages.find(m => m.role === 'system');
  if (systemMsg) {
    messages.push(systemMsg);
  }
  
  // Inject rolling digest for turns that fell out of the context window
  const historyMessages = session.messages.filter(m => m.role !== 'system');
  const { overflow } = splitByBudget(historyMessages);
  if (overflow.length > 0 && session.digest) {
    messages.push({
      role: 'system',
      content: `[Conversation digest — summary of ${overflow.length} earlier turns. Full transcript is preserved in the session file.]\n${session.digest}`
    });
  }
  
  // Recent messages that fit within budget
  const { kept } = splitByBudget(historyMessages);
  for (const msg of kept) {
    messages.push(msg);
  }
  
  // Add new prompt (if not already persisted in session)
  if (newPrompt) {
    messages.push({ role: 'user', content: newPrompt });
  }
  
  return messages;
}

/**
 * Get the turns that fell out of the API context window (candidates for digest update).
 */
export function getOverflowMessages(session: ConversationSession): Message[] {
  const historyMessages = session.messages.filter(m => m.role !== 'system');
  return splitByBudget(historyMessages).overflow;
}

/**
 * Get recent conversation history as formatted text
 */
export function getHistoryText(session: ConversationSession, maxMessages: number = 10): string {
  const recentMessages = session.messages
    .filter(m => m.role !== 'system')
    .slice(-maxMessages);
  
  if (recentMessages.length === 0) {
    return 'No conversation history.';
  }
  
  return recentMessages
    .map(m => {
      const role = m.role === 'user' ? chalk.blue('You') : chalk.green('AI');
      const content = m.content.length > 200 ? m.content.slice(0, 200) + '...' : m.content;
      return `${role}: ${content}`;
    })
    .join('\n\n');
}

/**
 * List all conversation sessions
 */
export function listSessions(): ConversationSession[] {
  ensureHistoryDir();
  
  try {
    const files = fs.readdirSync(HISTORY_DIR)
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse();
    
    const sessions: ConversationSession[] = [];
    
    for (const file of files.slice(0, MAX_HISTORY_FILES)) {
      try {
        const data = fs.readFileSync(path.join(HISTORY_DIR, file), 'utf8');
        const session = JSON.parse(data) as ConversationSession;
        session.startedAt = new Date(session.startedAt);
        session.lastActive = new Date(session.lastActive);
        sessions.push(session);
      } catch {
        // Skip invalid files
      }
    }
    
    return sessions;
  } catch {
    return [];
  }
}

/**
 * Delete a conversation session
 */
export function deleteSession(sessionId: string): boolean {
  ensureHistoryDir();
  const filePath = path.join(HISTORY_DIR, `${sessionId}.json`);
  
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  
  return false;
}

/**
 * Clear all conversation history
 */
export function clearAllHistory(): void {
  ensureHistoryDir();
  
  try {
    const files = fs.readdirSync(HISTORY_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      fs.unlinkSync(path.join(HISTORY_DIR, file));
    }
  } catch {
    // Ignore errors
  }
}

/**
 * Cleanup old session files (keep last MAX_HISTORY_FILES) AND their
 * satellite artifacts (shadow-git checkpoint repos, focus chains).
 */
function cleanupOldSessions(): void {
  try {
    const files = fs.readdirSync(HISTORY_DIR).filter((f) => f.endsWith('.json')).sort().reverse();
    const keptIds = new Set(files.slice(0, MAX_HISTORY_FILES).map((f) => f.replace(/\.json$/, '')));

    for (const file of files.slice(MAX_HISTORY_FILES)) {
      const id = file.replace(/\.json$/, '');
      try { fs.unlinkSync(path.join(HISTORY_DIR, file)); } catch {}
      removeSessionArtifacts(id);
    }

    // Second pass: orphaned artifacts whose session json is already gone
    sweepOrphanedArtifacts(keptIds);
  } catch {
    // ignore
  }
}

function appDataDir(sub: string): string {
  return path.join(
    process.env.HOME || process.env.USERPROFILE || '',
    '.config', 'octapus', sub
  );
}

function removeSessionArtifacts(id: string): void {
  const safe = id.replace(/[^A-Za-z0-9_-]/g, '_');
  try { fs.rmSync(appDataDir(path.join('checkpoints', safe)), { recursive: true, force: true }); } catch {}
  try { fs.unlinkSync(path.join(appDataDir('focus'), `${safe}.md`)); } catch {}
}

function sweepOrphanedArtifacts(keptIds: Set<string>): void {
  for (const sub of ['checkpoints', 'focus']) {
    const dir = appDataDir(sub);
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir)) {
      if (entry.startsWith('.')) continue; // shadow .git internals live inside per-session dirs
      const id = entry.replace(/\.(md|json|)$/, '');
      if (id && !keptIds.has(id)) {
        try { fs.rmSync(path.join(dir, entry), { recursive: true, force: true }); } catch {}
      }
    }
  }
}

/**
 * Get history directory path
 */
export function getHistoryDir(): string {
  return HISTORY_DIR;
}
