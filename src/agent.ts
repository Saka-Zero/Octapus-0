import { Router } from './router';
import { Message, ToolCall } from './providers';
import { AGENT_TOOLS, executeTool, notifyAfterTool, ToolApproval } from './tools';
import { pluginBeforeRequest } from './plugins';

const MAX_ITERATIONS = 15;

export interface AgentCallbacks {
  /** Streamed assistant text for the current turn */
  onText: (chunk: string) => void;
  /** A tool is about to run (after approval) */
  onToolStart: (name: string, args: string) => void;
  /** A tool finished — diff present for file writes */
  onToolResult: (name: string, ok: boolean, output: string, diff?: string[]) => void;
  /** Ask the user to approve a sensitive action */
  approval?: ToolApproval;
}

export interface AgentTurnResult {
  finalText: string;
  toolCallsMade: number;
}

/**
 * Agentic loop: chat → model may issue tool_calls → execute locally →
 * feed results back → repeat until the model answers in plain text
 * (or iteration/output budget is exhausted).
 */
export async function runAgentTurn(
  router: Router,
  history: Message[],
  model: string,
  config: any,
  options: any,
  cb: AgentCallbacks
): Promise<AgentTurnResult> {
  const messages = [...history];
  let finalText = '';
  let toolCallsMade = 0;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let turnText = '';
    let calls: ToolCall[] | null = null;

    for await (const ev of router.chat({
      model,
      messages,
      options: {
        model,
        temperature: options.temperature ?? config.settings.temperature,
        maxTokens: options.maxTokens ?? config.settings.maxTokens,
        stream: true,
        tools: AGENT_TOOLS,
        disableFallback: options.fallback === false,
        quiet: true,
        signal: options.signal
      },
      fallbackModels: options.fallback ? config.fallbackModels : [],
      domain: options.domain
    })) {
      if (ev.type === 'text') {
        turnText += ev.text;
        cb.onText(ev.text);
      } else if (ev.type === 'tool_calls') {
        calls = ev.calls;
      }
    }

    // No tools requested → this is the final answer
    if (!calls || calls.length === 0) {
      finalText += turnText;
      return { finalText, toolCallsMade };
    }

    // Model wants tools: persist its tool_call message, then execute each
    finalText += turnText;
    messages.push({
      role: 'assistant',
      content: turnText,
      ...(calls.length ? { tool_calls: calls } : {})
    });

    for (const call of calls) {
      if (toolCallsMade >= 25) {
        messages.push({ role: 'tool', tool_call_id: call.id, content: 'Tool budget exhausted.' });
        continue;
      }
      toolCallsMade++;

      let argsPreview = call.function.arguments;
      try {
        const parsed = JSON.parse(call.function.arguments || '{}');
        argsPreview = JSON.stringify(parsed).slice(0, 300);
      } catch { /* keep raw */ }

      const result = await executeTool(call.function.name, call.function.arguments, process.cwd(), cb.approval);
      cb.onToolStart(call.function.name, argsPreview);
      cb.onToolResult(call.function.name, result.ok, result.output, result.diff);
      try {
        notifyAfterTool(call.function.name, JSON.parse(call.function.arguments || '{}'), result);
      } catch { /* plugin errors never break the loop */ }

      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: `${result.ok ? 'OK' : 'ERROR'}: ${result.output}`
      });
    }
  }

  return { finalText: finalText + '\n(agent stopped: max iterations reached)', toolCallsMade };
}
