import { Provider, Message, ChatOptions } from './base';

export class OpenAICompatibleProvider implements Provider {
  name: string;
  models: string[] = [];
  priority: number;
  private apiKey: string;
  private baseURL: string;

  constructor(name: string, apiKey: string, baseURL: string, priority = 1, models: string[] = []) {
    this.name = name;
    this.apiKey = apiKey;
    this.baseURL = baseURL;
    this.priority = priority;
    this.models = models;
  }

  async validateKey(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseURL}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` }
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async getModels(): Promise<string[]> {
    try {
      const res = await fetch(`${this.baseURL}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` }
      });
      if (!res.ok) return this.models;
      const data = await res.json() as { data?: Array<{ id: string }> };
      this.models = data.data?.map((m) => m.id) || [];
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
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 4096,
      stream: true,
      tools: options.tools,
      tool_choice: options.toolChoice
    };

    const res = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`${this.name} API error (${res.status}): ${err}`);
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
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') return;
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices[0]?.delta?.content;
            if (content) yield content;
          } catch {}
        }
      }
    }
  }
}
