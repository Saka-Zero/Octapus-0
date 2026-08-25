import { execFile } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Shadow-git checkpoints (Cline/Roo pattern).
 *
 * A hidden git repo in app storage tracks the PROJECT directory via
 * GIT_DIR/GIT_WORK_TREE — the user's own .git is never touched.
 * Snapshot after every mutating tool call; restore = reset --hard plus
 * explicit removal of files created after the checkpoint (never git clean,
 * per Roo Code data-loss incident #6209).
 */

const CHECKPOINTS_ROOT = path.join(
  process.env.HOME || process.env.USERPROFILE || '',
  '.config', 'octapus', 'checkpoints'
);

export interface CheckpointInfo {
  hash: string;
  label: string;
  date: string;
}

interface GitResult {
  ok: boolean;
  out: string;
}

function git(args: string[], gitDir: string, workTree: string): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      {
        env: { ...process.env, GIT_DIR: gitDir, GIT_WORK_TREE: workTree },
        timeout: 60_000,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true
      },
      (err, stdout, stderr) => {
        resolve({ ok: !err, out: ((stdout as string) || '') + ((stderr as string) || '') });
      }
    );
  });
}

function repoPaths(sessionId: string): { cpDir: string; gitDir: string } {
  const safe = sessionId.replace(/[^A-Za-z0-9_-]/g, '_');
  const cpDir = path.join(CHECKPOINTS_ROOT, safe);
  return { cpDir, gitDir: path.join(cpDir, '.git') };
}

let gitAvailable: boolean | null = null;

/** Ensure the shadow repo exists for this session; returns null if git unavailable */
async function ensureRepo(sessionId: string, cwd: string): Promise<{ cpDir: string; gitDir: string } | null> {
  if (gitAvailable === null) {
    gitAvailable = await new Promise<boolean>((resolve) => {
      execFile('git', ['--version'], { timeout: 10_000 }, (err) => resolve(!err));
    });
    if (!gitAvailable) return null;
  }

  const { cpDir, gitDir } = repoPaths(sessionId);
  if (!fs.existsSync(gitDir)) {
    fs.mkdirSync(cpDir, { recursive: true });
    const init = await git(['init'], gitDir, cwd);
    if (!init.ok && !fs.existsSync(gitDir)) return null;
    // Local identity so commits never fail on missing global config
    await git(['config', 'user.email', 'checkpoint@octapus.local'], gitDir, cwd);
    await git(['config', 'user.name', 'Octapus Checkpoint'], gitDir, cwd);
    // Always-ignore heavy/volatile dirs regardless of project .gitignore
    const infoDir = path.join(gitDir, 'info');
    fs.mkdirSync(infoDir, { recursive: true });
    fs.writeFileSync(
      path.join(infoDir, 'exclude'),
      ['node_modules/', 'dist/', 'build/', '.next/', '__pycache__/', '.env', '*.log'].join('\n') + '\n'
    );
  }
  return { cpDir, gitDir };
}

/**
 * Snapshot current workspace state. Returns commit hash, or null when
 * nothing changed / git unavailable.
 */
export async function createCheckpoint(sessionId: string, cwd: string, label: string): Promise<string | null> {
  try {
    const repo = await ensureRepo(sessionId, cwd);
    if (!repo) return null;

    await git(['add', '-A'], repo.gitDir, cwd);
    const status = await git(['status', '--porcelain'], repo.gitDir, cwd);
    if (!status.out.trim()) return null; // nothing changed

    const commit = await git(['commit', '-m', label.slice(0, 200)], repo.gitDir, cwd);
    if (!commit.ok) return null;
    const hash = (await git(['rev-parse', 'HEAD'], repo.gitDir, cwd)).out.trim();
    return hash || null;
  } catch {
    return null;
  }
}

/** List checkpoints newest-first */
export async function listCheckpoints(sessionId: string, cwd: string): Promise<CheckpointInfo[]> {
  try {
    const { gitDir } = repoPaths(sessionId);
    if (!fs.existsSync(gitDir)) return [];
    const log = await git(
      ['log', '--pretty=format:%H|%s|%ci', '--reverse'],
      gitDir, cwd
    );
    if (!log.ok) return [];
    return log.out.trim().split('\n').filter(Boolean).map((line) => {
      const [hash, label, date] = line.split('|');
      return { hash, label, date };
    }).reverse();
  } catch {
    return [];
  }
}

export interface RestoreResult {
  ok: boolean;
  output: string;
}

/**
 * Restore workspace files to a checkpoint (Roo-safe):
 * 1. Delete files CREATED after the checkpoint (explicit manifest, never git clean)
 * 2. git reset --hard <hash>
 */
export async function restoreCheckpoint(sessionId: string, cwd: string, hash: string): Promise<RestoreResult> {
  try {
    const { gitDir } = repoPaths(sessionId);
    if (!fs.existsSync(gitDir)) return { ok: false, output: 'No checkpoints exist for this session.' };

    // Files added between checkpoint and now were created afterwards → remove
    const createdAfter = await git(
      ['diff', '--name-only', '--diff-filter=A', `${hash}`, 'HEAD'],
      gitDir, cwd
    );
    let removed = 0;
    if (createdAfter.ok && createdAfter.out.trim()) {
      for (const rel of createdAfter.out.split('\n').map((s) => s.trim()).filter(Boolean)) {
        const abs = path.join(cwd, rel);
        try {
          if (fs.existsSync(abs)) { fs.unlinkSync(abs); removed++; }
        } catch { /* skip undeletable */ }
      }
    }

    const reset = await git(['reset', '--hard', hash], gitDir, cwd);
    if (!reset.ok) return { ok: false, output: `Restore failed: ${reset.out.slice(0, 200)}` };

    return { ok: true, output: `Restored to ${hash.slice(0, 8)} (${removed} post-checkpoint files removed).` };
  } catch (e) {
    return { ok: false, output: `Restore failed: ${e instanceof Error ? e.message : e}` };
  }
}
