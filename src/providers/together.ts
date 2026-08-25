import { Provider, Message, ChatOptions } from './base';

export class TogetherProvider implements Provider {
  name = 'together';
  models = [
    'meta-llama/Llama-3.1-8B-Instruct-Turbo',
    'meta-llama/Llama-3.1-70B-Instruct-Turbo',
    'meta-llama/Llama-3.1-405B-Instruct-Turbo',
    'mistralai/Mixtral-8x7B-Instruct-v0.1',
    'google/gemma-2-9b-it',
    'Qwen/Qwen2.5-72B-Instruct-Turbo'
  ];
  priority = 4;
  private apiKey: string;
  private baseURL = 'https://api.together.xyz/v1';

  constructor(apiKey: string, baseURL?: string) {
    this.apiKey = apiKey;
    if (baseURL) this.baseURL = baseURL;
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
      return data.data?.map((m) => m.id) || this.models;
    } catch {
      return this.models;
    }
  }

  async *chat(messages: Message[], options: ChatOptions): AsyncIterable<string> {
    const body = {
      model: options.model,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
        tool_calls: m.tool_calls,
        tool_call_id: m.tool_call_id,
        name: m.name
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
      throw new Error(`Together API error (${res.status}): ${err}`);
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