import { ChatOptions, Message, StreamEvent, ToolCall } from './base';

interface DeltaToolCall {
  index: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

/** Structured HTTP error so the circuit breaker can classify failures */
export class ProviderHttpError extends Error {
  constructor(
    public providerName: string,
    public status: number,
    public retryAfterMs: number | undefined,
    body?: string
  ) {
    super(`${providerName} API error (${status}): ${body?.slice(0, 500)}`);
    this.name = 'ProviderHttpError';
  }
}

/** Real usage reported by the provider (when available) */
export interface UsageInfo {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

/**
 * Core OpenAI-compatible streaming engine.
 * Handles SSE parsing, text deltas, and incremental tool_call assembly.
 * Every Octapus provider delegates here — one implementation, tool support everywhere.
 */
export async function* streamOpenAI(opts: {
  baseURL: string;
  apiKey: string;
  messages: Message[];
  options: ChatOptions;
  providerName: string;
  extraHeaders?: Record<string, string>;
}): AsyncGenerator<StreamEvent> {
  const { baseURL, apiKey, messages, options, providerName, extraHeaders } = opts;

  const body: Record<string, unknown> = {
    model: options.model,
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
      ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
      ...(m.name ? { name: m.name } : {})
    })),
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 4096,
    stream: true
  };
  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools;
    if (options.toolChoice) body.tool_choice = options.toolChoice;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extraHeaders
  };
  // Only send auth when there's a real key — sending a placeholder makes
  // keyless providers (e.g. pollinations) treat us as authenticated users
  if (apiKey && apiKey !== 'none') {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  // Hard timeout so a stalled connection can never hang the CLI forever
  const timeoutSignal = AbortSignal.timeout(180_000);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutSignal])
    : timeoutSignal;

  const res = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => res.statusText);
    const ra = res.headers.get('retry-after');
    let retryAfterMs: number | undefined;
    if (ra) {
      retryAfterMs = /^\d+$/.test(ra.trim())
        ? parseInt(ra, 10) * 1000
        : Math.max(0, Date.parse(ra) - Date.now()) || undefined;
    }
    throw new ProviderHttpError(providerName, res.status, retryAfterMs, errText);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  // Assemble streamed tool_call deltas keyed by index
  const pendingCalls = new Map<number, { id: string; name: string; args: string }>();
  // SSE spec: an event's data may span multiple "data:" lines (join with \n)
  let dataLines: string[] | null = null;
  let sawDone = false;
  const MAX_BUFFER = 8_000_000; // malicious/no-newline streams must not OOM us

  /** Process one complete data payload. Throws ProviderHttpError on in-stream errors. */
  const handleData = (payload: string): StreamEvent[] => {
    if (payload === '[DONE]') { sawDone = true; return []; }
    let parsed: any;
    try { parsed = JSON.parse(payload); } catch { return []; }
    return handleParsed(parsed);
  };

  /** Core event extraction from a parsed SSE payload */
  const handleParsed = (parsed: any): StreamEvent[] => {
    if (parsed.error) {
      const code = parsed.error?.code === 429 || parsed.error?.status === 'RESOURCE_EXHAUSTED' ? 429 : 0;
      throw new ProviderHttpError(providerName, code, undefined, JSON.stringify(parsed.error).slice(0, 300));
    }
    const events: StreamEvent[] = [];
    // Real provider-reported usage (final chunk) — beats local estimation
    if (parsed.usage && typeof parsed.usage === 'object') {
      events.push({ type: 'usage', usage: parsed.usage });
    }
    const delta = parsed.choices?.[0]?.delta;
    if (!delta) return events;

    if (typeof delta.content === 'string' && delta.content) {
      events.push({ type: 'text', text: delta.content });
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls as DeltaToolCall[]) {
        // Validate index: integer, bounded — prevents Map flooding / NaN sorts
        if (!Number.isInteger(tc.index) || (tc.index as number) < 0 || (tc.index as number) > 127) continue;
        const slot = pendingCalls.get(tc.index) || { id: '', name: '', args: '' };
        if (tc.id) slot.id = tc.id;
        if (tc.function?.name) slot.name += tc.function.name;
        if (tc.function?.arguments) slot.args += tc.function.arguments;
        pendingCalls.set(tc.index, slot);
      }
    }
    return events;
  };

  const flushDataLines = async function* (): AsyncGenerator<StreamEvent> {
    if (!dataLines || dataLines.length === 0) { dataLines = null; return; }
    const lines2 = dataLines;
    dataLines = null;
    let parsed: any;
    const joined = lines2.join('\n');
    try { parsed = JSON.parse(joined); } catch {
      // Fallback: some splitters mean concatenation, not newline-join
      try { parsed = JSON.parse(lines2.join('')); } catch { return; }
    }
    for (const evt of handleParsed(parsed)) yield evt;
    if (sawDone) { yield* emitCalls(pendingCalls); }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > MAX_BUFFER) {
        throw new ProviderHttpError(providerName, 0, undefined, 'SSE buffer overflow — stream produced no line endings');
      }
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const rawLine of lines) {
        const line = rawLine.replace(/\r$/, '');

        if (line === '') {
          // Blank line = SSE event boundary
          yield* flushDataLines();
          if (sawDone) { yield* emitCalls(pendingCalls); return; }
          continue;
        }

        if (!line.startsWith('data')) continue; // comments/other fields ignored
        // 'data:' is 5 chars; optional single space follows (spec)
        const payload = line.slice(5).replace(/^ /, '');

        if (payload === '[DONE]') {
          sawDone = true;
          yield* flushDataLines();
          yield* emitCalls(pendingCalls);
          return;
        }

        if (!dataLines) dataLines = [];
        dataLines.push(payload);
      }
    }

    // Flush trailing buffered content (no final newline case)
    if (buffer.trim()) {
      for (const evt of handleData(buffer.replace(/\r$/, ''))) yield evt;
    }
    yield* flushDataLines();
    // Stream ended without [DONE] — still flush any assembled calls
    yield* emitCalls(pendingCalls);
  } finally {
    // Release the socket when the consumer breaks early (Esc abort etc.)
    reader.cancel().catch(() => {});
  }
}

/** Emit fully-assembled tool calls as a single final event */
async function* emitCalls(pending: Map<number, { id: string; name: string; args: string }>): AsyncGenerator<StreamEvent> {
  if (pending.size === 0) return;
  const calls: ToolCall[] = [];
  for (const [, slot] of [...pending.entries()].sort((a, b) => a[0] - b[0])) {
    calls.push({
      id: slot.id || `call_${Math.random().toString(36).slice(2, 10)}`,
      type: 'function',
      function: { name: slot.name, arguments: slot.args || '{}' }
    });
  }
  yield { type: 'tool_calls', calls };
}
