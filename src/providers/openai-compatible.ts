import { Provider, ChatOptions, Message, StreamEvent } from './base';
import { streamOpenAI } from './openai-stream';

/**
 * Universal OpenAI-compatible provider.
 * Covers all built-in providers (they all expose OpenAI-style APIs,
 * including Gemini and Ollama via their compatibility endpoints)
 * plus any custom provider added via `oct provider add`.
 */
export class OpenAICompatibleProvider implements Provider {
  name: string;
  models: string[] = [];
  priority: number;
  private apiKey: string;
  private baseURL: string;
  private extraHeaders?: Record<string, string>;

  constructor(
    name: string,
    apiKey: string,
    baseURL: string,
    priority = 1,
    models: string[] = [],
    extraHeaders?: Record<string, string>
  ) {
    this.name = name;
    this.apiKey = apiKey || 'none';
    this.baseURL = baseURL;
    this.priority = priority;
    this.models = models;
    this.extraHeaders = extraHeaders;
  }

  async validateKey(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseURL}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}`, ...this.extraHeaders }
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async getModels(): Promise<string[]> {
    try {
      const res = await fetch(`${this.baseURL}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}`, ...this.extraHeaders }
      });
      if (!res.ok) return this.models;
      const data = (await res.json()) as { data?: Array<{ id: string }> };
      const live = data.data?.map((m) => m.id) || [];
      if (live.length > 0) this.models = live.slice(0, 300);
      return this.models;
    } catch {
      return this.models;
    }
  }

  async *chat(messages: Message[], options: ChatOptions): AsyncIterable<StreamEvent> {
    yield* streamOpenAI({
      baseURL: this.baseURL,
      apiKey: this.apiKey,
      messages,
      options,
      providerName: this.name,
      extraHeaders: this.extraHeaders
    });
  }
}
