import * as fs from 'fs';
import * as path from 'path';
import { Message } from '../providers';
import chalk from 'chalk';

const HISTORY_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '', '.config', 'octapus', 'history');
const MAX_HISTORY_MESSAGES = 100; // Max messages to keep in context
const MAX_HISTORY_FILES = 20; // Max conversation files to keep

export interface ConversationSession {
  id: string;
  startedAt: Date;
  lastActive: Date;
  model: string;
  messages: Message[];
  title: string;
}

/**
 * Generate a short session ID from timestamp
 */
function generateSessionId(): string {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
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
  const id = sessionId || getCurrentSessionId();
  return path.join(HISTORY_DIR, `${id}.json`);
}

/**
 * Get current session ID (based on today's date)
 */
function getCurrentSessionId(): string {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
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
 * Save a conversation session
 */
export function saveSession(session: ConversationSession): void {
  ensureHistoryDir();
  const filePath = getSessionPath(session.id);
  fs.writeFileSync(filePath, JSON.stringify(session, null, 2));
  
  // Cleanup old sessions
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
 * Get messages for API call (with context window management)
 */
export function getMessagesForApi(session: ConversationSession, newPrompt: string): Message[] {
  const messages: Message[] = [];
  
  // Add system message if present
  const systemMsg = session.messages.find(m => m.role === 'system');
  if (systemMsg) {
    messages.push(systemMsg);
  }
  
  // Add conversation history (excluding system message)
  const historyMessages = session.messages.filter(m => m.role !== 'system');
  
  // If history is too long, keep the most recent messages
  const recentMessages = historyMessages.slice(-MAX_HISTORY_MESSAGES);
  
  for (const msg of recentMessages) {
    messages.push(msg);
  }
  
  // Add new prompt
  messages.push({ role: 'user', content: newPrompt });
  
  return messages;
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
 * Cleanup old session files (keep last MAX_HISTORY_FILES)
 */
function cleanupOldSessions(): void {
  try {
    const files = fs.readdirSync(HISTORY_DIR)
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse();
    
    if (files.length > MAX_HISTORY_FILES) {
      for (const file of files.slice(MAX_HISTORY_FILES)) {
        fs.unlinkSync(path.join(HISTORY_DIR, file));
      }
    }
  } catch {
    // Ignore errors
  }
}

/**
 * Get history directory path
 */
export function getHistoryDir(): string {
  return HISTORY_DIR;
}
