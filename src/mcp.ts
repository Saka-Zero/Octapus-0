import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Minimal native MCP (Model Context Protocol) stdio client.
 * Zero dependencies — implements the JSON-RPC-over-stdio subset of the
 * MCP spec directly (initialize handshake, tools/list, tools/call).
 * Avoids the ESM-only official SDK, which conflicts with our CJS build.
 */

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
}

export interface McpToolDef {
  server: string;
  /** Namespaced id used in LLM tool calls: mcp_<server>_<tool> */
  id: string;
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolResult {
  ok: boolean;
  output: string;
}

interface Pending {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

interface Connection {
  proc: ChildProcess;
  buffer: string;
  pending: Map<number, Pending>;
  nextId: number;
  initialized: boolean;
  tools: McpToolDef[];
}

const MCP_CONFIG_FILE = path.join(
  process.env.HOME || process.env.USERPROFILE || '',
  '.config', 'octapus', 'mcp.json'
);

const REQUEST_TIMEOUT_MS = 60_000;

export function loadMcpConfig(): Record<string, McpServerConfig> {
  try {
    if (!fs.existsSync(MCP_CONFIG_FILE)) return {};
    const data = JSON.parse(fs.readFileSync(MCP_CONFIG_FILE, 'utf8'));
    // Shape: { "mcpServers": { name: {...} } } (Claude-compatible) or flat map
    return data.mcpServers || data || {};
  } catch {
    return {};
  }
}

export class McpManager {
  private connections: Map<string, Connection> = new Map();
  private starting: Map<string, Promise<Connection | null>> = new Map();

  getConfig(): Record<string, McpServerConfig> {
    const cfg = loadMcpConfig();
    const out: Record<string, McpServerConfig> = {};
    for (const [name, c] of Object.entries(cfg)) {
      if ((c as McpServerConfig).enabled !== false && (c as McpServerConfig).command) {
        out[name] = c as McpServerConfig;
      }
    }
    return out;
  }

  private rawSend(conn: Connection, payload: object): number {
    const id = ++conn.nextId;
    const line = JSON.stringify({ jsonrpc: '2.0', id, ...payload }) + '\n';
    conn.proc.stdin?.write(line);
    return id;
  }

  private request<T = any>(conn: Connection, method: string, params?: object): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = conn.nextId + 1;
      const timer = setTimeout(() => {
        conn.pending.delete(id);
        reject(new Error(`MCP request ${method} timed out`));
      }, REQUEST_TIMEOUT_MS);
      conn.pending.set(id, { resolve, reject, timer });
      this.rawSend(conn, { method, params });
    });
  }

  /** Spawn + initialize handshake */
  async connect(serverName: string): Promise<Connection | null> {
    const existing = this.connections.get(serverName);
    if (existing?.initialized) return existing;
    const inFlight = this.starting.get(serverName);
    if (inFlight) return inFlight;

    const cfg = this.getConfig()[serverName];
    if (!cfg) return null;

    const promise = (async (): Promise<Connection | null> => {
      try {
        const proc = spawn(cfg.command, cfg.args || [], {
          env: { ...process.env, ...(cfg.env || {}) },
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true
        });

        const conn: Connection = {
          proc, buffer: '', pending: new Map(), nextId: 0,
          initialized: false, tools: []
        };

        proc.stdout!.on('data', (chunk: Buffer) => {
          conn.buffer += chunk.toString('utf8');
          let idx: number;
          while ((idx = conn.buffer.indexOf('\n')) >= 0) {
            const line = conn.buffer.slice(0, idx).trim();
            conn.buffer = conn.buffer.slice(idx + 1);
            if (!line) continue;
            try {
              const msg = JSON.parse(line);
              if (msg.id && conn.pending.has(msg.id)) {
                const p = conn.pending.get(msg.id)!;
                conn.pending.delete(msg.id);
                clearTimeout(p.timer);
                if (msg.error) p.reject(new Error(msg.error.message || 'MCP error'));
                else p.resolve(msg.result);
              }
            } catch { /* non-JSON line — ignore */ }
          }
        });

        proc.stderr!.on('data', () => { /* servers log to stderr; ignore */ });
        proc.on('exit', () => {
          for (const [, p] of conn.pending) { clearTimeout(p.timer); p.reject(new Error('MCP server exited')); }
          conn.pending.clear();
          if (this.connections.get(serverName) === conn) this.connections.delete(serverName);
        });

        // Initialize handshake
        await this.request(conn, 'initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'octapus', version: '0.1.0' }
        });
        this.rawSend(conn, { method: 'notifications/initialized' });
        conn.initialized = true;

        // Discover tools
        const listed: any = await this.request(conn, 'tools/list', {});
        conn.tools = (listed.tools || []).map((t: any) => ({
          server: serverName,
          id: `mcp_${serverName}_${t.name}`.replace(/[^A-Za-z0-9_-]/g, '_'),
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema || { type: 'object', properties: {} }
        }));

        this.connections.set(serverName, conn);
        return conn;
      } catch (e) {
        console.warn(`⚠ MCP server "${serverName}" failed to start: ${e instanceof Error ? e.message : e}`);
        return null;
      } finally {
        this.starting.delete(serverName);
      }
    })();

    this.starting.set(serverName, promise);
    return promise;
  }

  /** Discover tools across all configured servers (lazy-connects each once) */
  async getAllTools(): Promise<McpToolDef[]> {
    const all: McpToolDef[] = [];
    for (const name of Object.keys(this.getConfig())) {
      const conn = await this.connect(name);
      if (conn) all.push(...conn.tools);
    }
    return all;
  }

  async callTool(server: string, toolName: string, args: Record<string, unknown>): Promise<McpToolResult> {
    const conn = await this.connect(server);
    if (!conn) return { ok: false, output: `MCP server "${server}" not connected.` };
    const result: any = await this.request(conn, 'tools/call', { name: toolName, arguments: args });
    const content = Array.isArray(result.content)
      ? result.content.map((c: any) => (c.type === 'text' ? c.text : `[${c.type}]`)).join('\n')
      : JSON.stringify(result);
    return { ok: !result.isError, output: content };
  }

  disconnectAll(): void {
    for (const [, conn] of this.connections) {
      try { conn.proc.kill(); } catch {}
    }
    this.connections.clear();
  }
}

// Process-wide singleton so agent + commands share connections
export const mcpManager = new McpManager();

/** Convert MCP tool defs to OpenAI tool schema for the agent loop */
export function mcpToOpenAiTools(defs: McpToolDef[]): Array<{
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}> {
  return defs.map((d) => ({
    type: 'function' as const,
    function: {
      name: d.id,
      description: `[MCP:${d.server}] ${d.description || d.name}`,
      parameters: d.inputSchema
    }
  }));
}
