import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { Tool } from './providers';
import { researchQuery, webFetch } from './web';
import { loadPlugins, pluginBeforeRequest, ToolHookResult } from './plugins';

/** Permission action from config: allow (skip approval) | ask | deny */
export type PermissionAction = 'allow' | 'ask' | 'deny';
export type PermissionMap = Partial<Record<string, PermissionAction>>;

let activePermissions: PermissionMap = {};
export function setPermissions(map: PermissionMap): void {
  activePermissions = map || {};
}
export function getPermissions(): PermissionMap {
  return activePermissions;
}

// ─── Plan/Act mode (Cline pattern) ──────────────────────────────────
let planModeActive = false;
export function setPlanMode(active: boolean): void {
  planModeActive = active;
}
export function isPlanMode(): boolean {
  return planModeActive;
}

/** Tools allowed while planning — read-only research */
export const PLAN_ALLOWED = new Set(['read_file', 'list_dir', 'search_files', 'web_search', 'web_fetch']);

export interface ToolResult {
  ok: boolean;
  output: string;
  /** Unified-ish diff lines for file writes (for colored TUI rendering) */
  diff?: string[];
}

const MAX_OUTPUT = 8000;
const MAX_FILE_WRITE = 512 * 1024;
const CMD_TIMEOUT_MS = 60_000;

/**
 * Compact line diff between old and new content.
 * Common prefix/suffix trimmed, changed region shown with ±3 context lines.
 */
export function diffLines(oldContent: string, newContent: string, maxLines = 60): string[] {
  const a = oldContent.split('\n');
  const b = newContent.split('\n');

  if (oldContent === newContent) return [];

  // Trim common prefix
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  // Trim common suffix
  let endA = a.length - 1, endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) { endA--; endB--; }

  const ctx = 3;
  const out: string[] = [];

  // Context before change
  for (let i = Math.max(0, start - ctx); i < start; i++) out.push(`  ${a[i]}`);
  // Removed lines (old only)
  for (let i = start; i <= endA; i++) out.push(`- ${a[i]}`);
  // Added lines (new only)
  for (let i = start; i <= endB; i++) out.push(`+ ${b[i]}`);
  // Context after change (common suffix)
  for (let i = endA + 1; i <= Math.min(a.length - 1, endA + ctx); i++) out.push(`  ${a[i]}`);

  if (out.length > maxLines) {
    const kept = out.slice(0, maxLines);
    kept.push(`… (+${out.length - maxLines} more diff lines)`);
    return kept;
  }
  return out;
}

/** Patterns we refuse to run even with approval */
const DANGEROUS = [
  /rm\s+-rf\s+\/(?!tmp|home|users)/i,
  /\bformat\b.*:/i,
  /\bshutdown\b|\breboot\b/i,
  /\bdel\s+\/[sf]\s/i,
  /:\(\)\{.*\};:/, // fork bomb
  /\bmkfs\b/i,
  /\bdd\s+if=\/dev\/zero\s+of=\/dev\//i,
  /Remove-Item\s+.*-Recurs/i,
  /rmdir\s+\/s/i,
  /reg\s+delete/i,
  /vssadmin/i,
  /\bcurl\b[^|]*\|\s*(ba)?sh/i,
  /Invoke-Expression/i
];

// ─── Sandbox: protect sensitive files from agent reads/writes ──────
const SENSITIVE_PATTERNS = [
  /[\\/]\.ssh([\\/]|$)/i,
  /[\\/]\.aws([\\/]|$)/i,
  /[\\/]\.config[\\/]octapus([\\/]|$)/i,
  /[\\/]\.gnupg([\\/]|$)/i,
  /\.pem$/i,
  /\.key$/i,
  /id_rsa|id_ed25519|id_ecdsa/i,
  /\.env($|\.[^.]+$)/i,
  /credentials?\.json$/i
];

function isSensitivePath(resolved: string): boolean {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (home && resolved.startsWith(path.resolve(home))) {
    // Outside cwd & inside home → require scrutiny below
  }
  return SENSITIVE_PATTERNS.some((rx) => rx.test(resolved));
}

/** Scrub API-key-looking strings from tool output before it reaches any LLM */
function scrubSecrets(s: string): string {
  return s
    .replace(/\bsk-[A-Za-z0-9]{20,}\b/g, 'sk-[REDACTED]')
    .replace(/\bgsk_[A-Za-z0-9]{20,}\b/g, 'gsk-[REDACTED]')
    .replace(/\bghp_[A-Za-z0-9]{20,}\b/g, 'ghp-[REDACTED]')
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, 'github_pat_[REDACTED]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, 'AKIA[REDACTED]')
    .replace(/\bAQ\.[A-Za-z0-9_-]{20,}\b/g, 'AQ.[REDACTED]');
}

export const AGENT_TOOLS: Tool[] = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file. Use relative or absolute paths.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to read' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create or overwrite a file with the given content. Parent directories are created automatically.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to write' },
          content: { type: 'string', description: 'Full file content' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'List files and folders in a directory.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path (default: current directory)' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Execute a shell command in the current working directory and return stdout/stderr. Requires user approval unless auto-approve is on.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The command to execute' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: 'Search file contents with a regex across the directory tree. Skips node_modules/.git/dist.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regex pattern to search for' },
          path: { type: 'string', description: 'Directory to search (default: current directory)' },
          glob: { type: 'string', description: 'Optional file extension filter like ".ts"' }
        },
        required: ['pattern']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the live internet (DuckDuckGo, keyless). Use for current events, latest CVEs, recent releases, documentation lookups — anything past your knowledge cutoff.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          deep: { type: 'boolean', description: 'If true, also fetch the top result page for full context' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_fetch',
      description: 'Fetch a public http(s) URL and return its readable text content.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL to fetch' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'switch_to_act_mode',
      description: 'Request to exit plan mode and begin executing your implementation plan. Only call this after presenting a complete numbered plan.',
      parameters: {
        type: 'object',
        properties: {
          plan_summary: { type: 'string', description: 'Brief summary of the approved plan you will execute' }
        },
        required: ['plan_summary']
      }
    }
  }
];

export interface ToolApproval {
  /** Return true to allow execution */
  (toolName: string, summary: string): Promise<boolean>;
}

export async function executeTool(
  name: string,
  argsJson: string,
  cwd: string,
  approve?: ToolApproval
): Promise<ToolResult> {
  let args: any = {};
  try {
    args = JSON.parse(argsJson || '{}');
  } catch {
    return { ok: false, output: `Invalid JSON arguments: ${argsJson.slice(0, 200)}` };
  }

  // Plugin veto/mutation hook — runs before permission checks
  for (const plugin of loadPlugins()) {
    try {
      const res: ToolHookResult | void = plugin.onBeforeToolCall?.(name, args);
      if (res?.block) {
        return { ok: false, output: `Blocked by plugin "${plugin.name}": ${res.reason || 'policy'}` };
      }
      if (res?.args) args = res.args;
    } catch (e) {
      console.warn(`⚠ plugin ${plugin.name} onBeforeToolCall error: ${e instanceof Error ? e.message : e}`);
    }
  }

  // Permission map from config: deny blocks outright, allow skips approval,
  // ask falls through to the approve callback
  const perm = activePermissions[name];
  let effectiveApprove = approve;
  if (perm === 'deny') {
    return { ok: false, output: `BLOCKED: tool "${name}" is denied by permissions config.` };
  }
  if (perm === 'allow') effectiveApprove = undefined;

  // PLAN MODE gate (Cline pattern): research-only. Mutating tools are blocked
  // with an instruction telling the model to produce a plan instead.
  if (planModeActive && !PLAN_ALLOWED.has(name)) {
    return {
      ok: false,
      output: `BLOCKED: plan mode is active — only read/research tools allowed. Research the task, then present a numbered implementation plan and request switch_to_act_mode to begin execution.`
    };
  }

  // Unified ask-gate honoring perm==='ask' for EVERY tool:
  // - agent context: delegate to the interactive approval callback
  // - no callback available (non-agent): deny rather than silently allow
  if (perm === 'ask') {
    const summary = argsJson.slice(0, 120);
    const ok = approve ? await approve(name, summary) : false;
    if (!ok) return { ok: false, output: `User denied ${name} (permissions: ask).` };
    effectiveApprove = undefined; // already approved above
  }

  switch (name) {
    case 'read_file':
      return doReadFile(String(args.path || ''));
    case 'write_file':
      return doWriteFile(String(args.path || ''), String(args.content ?? ''), effectiveApprove);
    case 'list_dir':
      return doListDir(String(args.path || '.'));
    case 'run_command':
      return doRunCommand(String(args.command || ''), cwd, effectiveApprove);
    case 'search_files':
      return doSearchFiles(String(args.pattern || ''), String(args.path || '.'), args.glob ? String(args.glob) : undefined);
    case 'web_search':
      return researchQuery(String(args.query || ''), Boolean(args.deep)).then(
        (output) => ({ ok: true, output: cap(scrubSecrets(output)) }),
        (e) => ({ ok: false, output: `web_search failed: ${e instanceof Error ? e.message : e}` })
      );
    case 'web_fetch':
      return webFetch(String(args.url || '')).then(
        (output) => ({ ok: true, output: cap(scrubSecrets(output)) }),
        (e) => ({ ok: false, output: `web_fetch failed: ${e instanceof Error ? e.message : e}` })
      );
    default:
      return { ok: false, output: `Unknown tool: ${name}` };
  }
}

/** Fire onAfterToolCall across plugins (fire-and-forget safe) */
export function notifyAfterTool(name: string, args: Record<string, unknown>, result: ToolResult): void {
  for (const plugin of loadPlugins()) {
    try {
      plugin.onAfterToolCall?.(name, args, result);
    } catch {
      // plugin errors never break the loop
    }
  }
}

function cap(s: string): string {
  return s.length > MAX_OUTPUT ? s.slice(0, MAX_OUTPUT) + `\n… (truncated, ${s.length} chars total)` : s;
}

async function doReadFile(p: string): Promise<ToolResult> {
  try {
    const resolved = path.resolve(p);
    if (isSensitivePath(resolved)) {
      return { ok: false, output: `BLOCKED: "${resolved}" matches a protected path (SSH keys, credentials, provider configs). Reading it would send its contents to external AI providers.` };
    }
    const stat = fs.statSync(resolved);
    if (stat.size > 1024 * 1024) return { ok: false, output: 'File too large (>1MB)' };
    const content = fs.readFileSync(resolved, 'utf8');
    return { ok: true, output: cap(scrubSecrets(content)) };
  } catch (e) {
    return { ok: false, output: `read_file failed: ${e instanceof Error ? e.message : e}` };
  }
}

const BACKUP_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '',
  '.config', 'octapus', 'backups'
);

/** Snapshot a file before the agent overwrites it (undo safety net). */
function checkpointFile(resolved: string): void {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeName = resolved.replace(/[\\/]/g, '__');
    const dest = path.join(BACKUP_DIR, `${stamp}__${safeName}.bak`);
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    fs.copyFileSync(resolved, dest);
    // Prune: keep newest 50 backups
    const all = fs.readdirSync(BACKUP_DIR).sort().reverse();
    for (const old of all.slice(50)) {
      fs.unlinkSync(path.join(BACKUP_DIR, old));
    }
  } catch {
    // checkpoint is best-effort; never block the write
  }
}

async function doWriteFile(p: string, content: string, approve?: ToolApproval): Promise<ToolResult> {
  try {
    if (content.length > MAX_FILE_WRITE) return { ok: false, output: 'Content too large (>512KB)' };
    const resolved = path.resolve(p);
    if (isSensitivePath(resolved)) {
      return { ok: false, output: `BLOCKED: "${resolved}" is a protected path (SSH keys, credentials, provider configs). The agent may not write there.` };
    }
    const existed = fs.existsSync(resolved);
    const oldContent = existed ? fs.readFileSync(resolved, 'utf8') : '';

    if (approve) {
      const action = existed ? `edit ${resolved}` : `create ${resolved}`;
      const ok = await approve('write_file', `${action} (${content.length} bytes)`);
      if (!ok) return { ok: false, output: 'User denied this write.' };
    }
    if (existed) checkpointFile(resolved);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, content, 'utf8');

    const diff = diffLines(oldContent, content);
    return {
      ok: true,
      output: `${existed ? 'Updated' : 'Created'} ${resolved} (${content.length} bytes)${existed ? ' [checkpoint saved]' : ''}`,
      diff
    };
  } catch (e) {
    return { ok: false, output: `write_file failed: ${e instanceof Error ? e.message : e}` };
  }
}

async function doListDir(p: string): Promise<ToolResult> {
  try {
    const resolved = path.resolve(p);
    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    const lines = entries.map((e) => `${e.isDirectory() ? 'd' : '-'} ${e.name}`);
    return { ok: true, output: cap(`${resolved}\n${lines.join('\n')}`) };
  } catch (e) {
    return { ok: false, output: `list_dir failed: ${e instanceof Error ? e.message : e}` };
  }
}

async function doRunCommand(command: string, cwd: string, approve?: ToolApproval): Promise<ToolResult> {
  if (DANGEROUS.some((rx) => rx.test(command))) {
    return { ok: false, output: 'Blocked: command matches a dangerous pattern and is never allowed.' };
  }
  if (approve) {
    const ok = await approve('run_command', command);
    if (!ok) return { ok: false, output: 'User denied this command.' };
  }
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    execFile(
      isWin ? 'cmd.exe' : 'bash',
      isWin ? ['/c', command] : ['-lc', command],
      { cwd, timeout: CMD_TIMEOUT_MS, maxBuffer: 2 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        const out = [stdout?.toString(), stderr?.toString()].filter(Boolean).join('\n--- stderr ---\n');
        if (err && !out) {
          resolve({ ok: false, output: cap(`Command failed: ${err.message}`) });
        } else {
          resolve({ ok: !err, output: cap(scrubSecrets(out || '(no output)')) });
        }
      }
    );
  });
}

async function doSearchFiles(pattern: string, dir: string, ext?: string): Promise<ToolResult> {
  const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__']);
  const results: string[] = [];
  let rx: RegExp;
  try {
    rx = new RegExp(pattern, 'i');
  } catch (e) {
    return { ok: false, output: `Invalid regex: ${e instanceof Error ? e.message : e}` };
  }

  const walk = (d: string, depth: number): void => {
    if (depth > 6 || results.length >= 50) return;
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (results.length >= 50) return;
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!SKIP.has(e.name)) walk(full, depth + 1);
        continue;
      }
      if (ext && !e.name.endsWith(ext)) continue;
      try {
        const stat = fs.statSync(full);
        if (stat.size > 512 * 1024) continue;
        const content = fs.readFileSync(full, 'utf8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (rx.test(lines[i])) {
            results.push(`${full}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
            if (results.length >= 50) return;
          }
        }
      } catch {
        // unreadable file — skip
      }
    }
  };

  walk(path.resolve(dir), 0);
  return results.length
    ? { ok: true, output: cap(scrubSecrets(results.join('\n'))) }
    : { ok: true, output: 'No matches found.' };
}
