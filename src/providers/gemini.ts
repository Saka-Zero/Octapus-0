import { Provider, Message, ChatOptions } from './base';

export class GeminiProvider implements Provider {
  name = 'gemini';
  models = [
    'gemini-1.5-pro-latest',
    'gemini-1.5-flash-latest',
    'gemini-1.5-pro-002',
    'gemini-1.5-flash-002',
    'gemini-1.0-pro'
  ];
  priority = 8;
  private apiKey: string;
  private baseURL = 'https://generativelanguage.googleapis.com/v1beta';

  constructor(apiKey: string, baseURL?: string) {
    this.apiKey = apiKey;
    if (baseURL) this.baseURL = baseURL;
  }

  async validateKey(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseURL}/models?key=${this.apiKey}`);
      return res.ok;
    } catch {
      return false;
    }
  }

  async getModels(): Promise<string[]> {
    try {
      const res = await fetch(`${this.baseURL}/models?key=${this.apiKey}`);
      if (!res.ok) return this.models;
      const data = await res.json() as { models?: Array<{ name: string }> };
      return data.models?.map((m) => m.name.replace('models/', '')) || this.models;
    } catch {
      return this.models;
    }
  }

  private convertMessages(messages: Message[]) {
    // Extract system message for systemInstruction
    const systemMsg = messages.find(m => m.role === 'system');
    const nonSystem = messages.filter(m => m.role !== 'system');
    return {
      contents: nonSystem.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      })),
      systemInstruction: systemMsg ? { parts: [{ text: systemMsg.content }] } : undefined
    };
  }

  async *chat(messages: Message[], options: ChatOptions): AsyncIterable<string> {
    const converted = this.convertMessages(messages);
    const body: any = {
      contents: converted.contents,
      generationConfig: {
        temperature: options.temperature ?? 0.7,
        maxOutputTokens: options.maxTokens ?? 4096,
        topP: 0.95,
        topK: 40
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' }
      ]
    };
    if (converted.systemInstruction) {
      body.systemInstruction = converted.systemInstruction;
    }

    const url = `${this.baseURL}/models/${options.model}:streamGenerateContent?key=${this.apiKey}&alt=sse`;
    
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gemini API error (${res.status}): ${err}`);
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
          if (!data || data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            const content = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
            if (content) yield content;
          } catch {}
        }
      }
    }
  }
}