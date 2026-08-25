import { ChatOptions, Message, StreamEvent, ToolCall } from './base';

interface DeltaToolCall {
  index: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
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
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`${providerName} API error (${res.status}): ${err.slice(0, 500)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  // Assemble streamed tool_call deltas keyed by index
  const pendingCalls = new Map<number, { id: string; name: string; args: string }>();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();

        if (data === '[DONE]') {
          yield* emitCalls(pendingCalls);
          return;
        }

        let parsed: any;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }
        // Some providers send errors with HTTP 200 — surface them
        if (parsed.error) {
          throw new Error(`${providerName} stream error: ${JSON.stringify(parsed.error).slice(0, 300)}`);
        }
        const delta = parsed.choices?.[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          yield { type: 'text', text: delta.content };
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls as DeltaToolCall[]) {
            const slot = pendingCalls.get(tc.index) || { id: '', name: '', args: '' };
            if (tc.id) slot.id = tc.id;
            if (tc.function?.name) slot.name += tc.function.name;
            if (tc.function?.arguments) slot.args += tc.function.arguments;
            pendingCalls.set(tc.index, slot);
          }
        }
      }
    }
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
