export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatOptions {
  model: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  tools?: Tool[];
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  /** Router-level flag: when true, only the primary provider is tried (no fallback) */
  disableFallback?: boolean;
  /** Router-level flag: suppress console notifications (used by TUI mode) */
  quiet?: boolean;
  /** Abort signal for interrupting generation (Esc in TUI) */
  signal?: AbortSignal;
}

export interface Tool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface Provider {
  name: string;
  models: string[];
  priority: number;
  chat(messages: Message[], options: ChatOptions): AsyncIterable<StreamEvent>;
  validateKey(): Promise<boolean>;
  getModels(): Promise<string[]>;
}

/** Streaming events emitted by providers */
export type StreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_calls'; calls: ToolCall[] };

export interface ProviderConfig {
  apiKey?: string;
  baseURL?: string;
  priority?: number;
  enabled?: boolean;
  models?: string[];
  /** Specialty for role-based routing: general | coder | security | fast */
  role?: 'general' | 'coder' | 'security' | 'fast';
}

export interface RouterOptions {
  model: string;
  messages: Message[];
  options: ChatOptions;
  fallbackModels?: string[];
  /** Intent domain for role-based routing: coding | security | general */
  domain?: string;
}