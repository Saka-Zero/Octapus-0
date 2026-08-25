import { Provider, Message, ChatOptions } from './base';

export class OllamaProvider implements Provider {
  name = 'ollama';
  models: string[] = [];
  priority = 5;
  private baseURL: string;

  constructor(baseURL = 'http://localhost:11434') {
    this.baseURL = baseURL;
  }

  async validateKey(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseURL}/api/tags`);
      return res.ok;
    } catch {
      return false;
    }
  }

  async getModels(): Promise<string[]> {
    try {
      const res = await fetch(`${this.baseURL}/api/tags`);
      if (!res.ok) return this.models;
      const data = await res.json() as { models?: Array<{ name: string }> };
      this.models = data.models?.map((m) => m.name) || [];
      return this.models;
    } catch {
      return this.models;
    }
  }

  async *chat(messages: Message[], options: ChatOptions): AsyncIterable<string> {
    const body = {
      model: options.model,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content
      })),
      stream: true,
      options: {
        temperature: options.temperature ?? 0.7,
        num_predict: options.maxTokens ?? 4096
      }
    };

    const res = await fetch(`${this.baseURL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Ollama API error (${res.status}): ${err}`);
    }

    const reader = res.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          const content = parsed.message?.content;
          if (content) yield content;
          if (parsed.done) return;
        } catch {}
      }
    }
  }
}