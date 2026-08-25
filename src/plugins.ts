import * as fs from 'fs';
import * as path from 'path';

/**
 * Minimal plugin system — drop-in CommonJS modules that hook into the AI loop.
 *
 * Plugin shape (~/.config/octapus/plugins/my-plugin.js):
 *   module.exports = {
 *     name: 'my-plugin',
 *     // Return { block: true, reason } to veto a tool call,
 *     // or { args } to modify arguments
 *     onBeforeToolCall(name, args) { ... },
 *     onAfterToolCall(name, args, result) { ... },
 *     // Extra text appended to every system prompt
 *     onSystemPrompt() { return '...' },
 *     // Mutate request options per LLM call (temperature, maxTokens...)
 *     onBeforeRequest(opts) { return opts }
 *   };
 */

export interface ToolHookResult {
  block?: boolean;
  reason?: string;
  args?: Record<string, unknown>;
}

export interface OctapusPlugin {
  name: string;
  onBeforeToolCall?(name: string, args: Record<string, unknown>): ToolHookResult | void;
  onAfterToolCall?(name: string, args: Record<string, unknown>, result: { ok: boolean; output: string }): void;
  onSystemPrompt?(): string | void;
  onBeforeRequest?(opts: Record<string, unknown>): Record<string, unknown> | void;
}

const PLUGINS_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '',
  '.config', 'octapus', 'plugins'
);

let loaded: OctapusPlugin[] | null = null;

/** Load all *.js plugins from the plugins dir (hot-reloads via mtime). */
export function loadPlugins(): OctapusPlugin[] {
  let sig = 'none';
  try {
    if (fs.existsSync(PLUGINS_DIR)) {
      const stat = fs.statSync(PLUGINS_DIR);
      // Per-FILE mtimes — editing a plugin's content must invalidate the cache
      const files = fs
        .readdirSync(PLUGINS_DIR)
        .map((f) => {
          try { return `${f}:${fs.statSync(path.join(PLUGINS_DIR, f)).mtimeMs}`; } catch { return f; }
        })
        .join(',');
      sig = `${stat.mtimeMs}:${files}`;
    }
  } catch { sig = 'err'; }

  if (loaded && sig === cacheSig) return loaded;
  cacheSig = sig;

  const plugins: OctapusPlugin[] = [];
  try {
    if (!fs.existsSync(PLUGINS_DIR)) {
      loaded = plugins;
      return plugins;
    }
    for (const f of fs.readdirSync(PLUGINS_DIR)) {
      if (!f.endsWith('.js')) continue;
      const resolved = path.join(PLUGINS_DIR, f);
      try {
        // Bust Node's require cache so edited plugins actually reload
        delete require.cache[resolved];
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require(resolved);
        const p = mod.default || mod;
        if (p && typeof p === 'object') {
          plugins.push({ name: p.name || f.replace('.js', ''), ...p });
        }
      } catch (e) {
        console.warn(`⚠ Plugin ${f} failed to load: ${e instanceof Error ? e.message : e}`);
      }
    }
  } catch {
    // ignore
  }
  loaded = plugins;
  return plugins;
}

let cacheSig = '';

export function getPluginCount(): number {
  return loadPlugins().length;
}

/** Run onSystemPrompt across plugins; returns concatenated additions.
 *  Async hook results are contained — rejections never escape. */
export function pluginSystemPrompt(): string {
  const parts: string[] = [];
  for (const p of loadPlugins()) {
    try {
      const out = p.onSystemPrompt?.();
      if (out && typeof (out as unknown as Promise<string>).then === 'function') {
        // Async result arrives too late for this prompt — contain the rejection
        (Promise.resolve(out) as Promise<string>).catch(() => {});
      } else if (typeof out === 'string' && out.trim()) {
        parts.push(out.trim());
      }
    } catch (e) {
      console.warn(`⚠ plugin ${p.name} onSystemPrompt error: ${e instanceof Error ? e.message : e}`);
    }
  }
  return parts.join('\n\n');
}

/** Pre-request mutation hook */
export function pluginBeforeRequest<T extends Record<string, unknown>>(opts: T): T {
  let out = opts;
  for (const p of loadPlugins()) {
    try {
      const res = p.onBeforeRequest?.(out as Record<string, unknown>);
      if (res && typeof res === 'object') out = res as T;
    } catch {
      // plugin errors never break requests
    }
  }
  return out;
}
