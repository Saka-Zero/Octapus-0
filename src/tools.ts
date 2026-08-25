import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { Tool } from './providers';

export interface ToolResult {
  ok: boolean;
  output: string;
}

const MAX_OUTPUT = 8000;
const MAX_FILE_WRITE = 512 * 1024;
const CMD_TIMEOUT_MS = 60_000;

/** Patterns we refuse to run even with approval */
const DANGEROUS = [
  /rm\s+-rf\s+\/(?!tmp|home|users)/i,
  /\bformat\b.*:/i,
  /\bshutdown\b|\breboot\b/i,
  /\bdel\s+\/[sf]\s/i,
  /:\(\)\{.*\};:/, // fork bomb
  /\bmkfs\b/i,
  /\bdd\s+if=\/dev\/zero\s+of=\/dev\//i
];

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

  switch (name) {
    case 'read_file':
      return doReadFile(String(args.path || ''));
    case 'write_file':
      return doWriteFile(String(args.path || ''), String(args.content ?? ''), approve);
    case 'list_dir':
      return doListDir(String(args.path || '.'));
    case 'run_command':
      return doRunCommand(String(args.command || ''), cwd, approve);
    case 'search_files':
      return doSearchFiles(String(args.pattern || ''), String(args.path || '.'), args.glob ? String(args.glob) : undefined);
    default:
      return { ok: false, output: `Unknown tool: ${name}` };
  }
}

function cap(s: string): string {
  return s.length > MAX_OUTPUT ? s.slice(0, MAX_OUTPUT) + `\n… (truncated, ${s.length} chars total)` : s;
}

async function doReadFile(p: string): Promise<ToolResult> {
  try {
    const resolved = path.resolve(p);
    const stat = fs.statSync(resolved);
    if (stat.size > 1024 * 1024) return { ok: false, output: 'File too large (>1MB)' };
    const content = fs.readFileSync(resolved, 'utf8');
    return { ok: true, output: cap(content) };
  } catch (e) {
    return { ok: false, output: `read_file failed: ${e instanceof Error ? e.message : e}` };
  }
}

async function doWriteFile(p: string, content: string, approve?: ToolApproval): Promise<ToolResult> {
  try {
    if (content.length > MAX_FILE_WRITE) return { ok: false, output: 'Content too large (>512KB)' };
    const resolved = path.resolve(p);
    if (approve) {
      const ok = await approve('write_file', `${resolved} (${content.length} bytes)`);
      if (!ok) return { ok: false, output: 'User denied this write.' };
    }
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, content, 'utf8');
    return { ok: true, output: `Wrote ${content.length} bytes to ${resolved}` };
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
          resolve({ ok: !err, output: cap(out || '(no output)') });
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
    ? { ok: true, output: cap(results.join('\n')) }
    : { ok: true, output: 'No matches found.' };
}
