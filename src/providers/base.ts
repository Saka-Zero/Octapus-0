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
  chat(messages: Message[], options: ChatOptions): AsyncIterable<string>;
  validateKey(): Promise<boolean>;
  getModels(): Promise<string[]>;
}

export interface ProviderConfig {
  apiKey?: string;
  baseURL?: string;
  priority?: number;
  enabled?: boolean;
  models?: string[];
}

export interface RouterOptions {
  model: string;
  messages: Message[];
  options: ChatOptions;
  fallbackModels?: string[];
}