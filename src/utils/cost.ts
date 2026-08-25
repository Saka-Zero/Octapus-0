export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

export interface CostBreakdown {
  provider: string;
  model: string;
  usage: TokenUsage;
  cost: number;
  currency: string;
}

const PRICING: Record<string, Record<string, { input: number; output: number }>> = {
  groq: {
    'llama-3.1-70b-versatile': { input: 0, output: 0 },
    'llama-3.1-8b-instant': { input: 0, output: 0 },
    'gemma2-9b-it': { input: 0, output: 0 },
    'mixtral-8x7b-32768': { input: 0, output: 0 }
  },
  cerebras: {
    '*': { input: 0, output: 0 }
  },
  gemini: {
    'gemini-1.5-pro-latest': { input: 0, output: 0 },
    'gemini-1.5-flash-latest': { input: 0, output: 0 }
  },
  sambanova: {
    '*': { input: 0, output: 0 }
  },
  ollama: {
    '*': { input: 0, output: 0 }
  },
  together: {
    '*': { input: 0.0001, output: 0.0003 }
  },
  openrouter: {
    '*': { input: 0.00015, output: 0.0006 }
  },
  novita: {
    '*': { input: 0.0001, output: 0.0003 }
  },
  requesty: {
    '*': { input: 0.00015, output: 0.0006 }
  },
  'github-models': {
    '*': { input: 0, output: 0 }
  },
  mistral: {
    '*': { input: 0, output: 0 }
  },
  nvidia: {
    '*': { input: 0, output: 0 }
  },
  cohere: {
    '*': { input: 0, output: 0 }
  },
  huggingface: {
    '*': { input: 0, output: 0 }
  },
  zhipu: {
    '*': { input: 0, output: 0 }
  },
  siliconflow: {
    '*': { input: 0, output: 0 }
  },
  modelscope: {
    '*': { input: 0, output: 0 }
  },
  pollinations: {
    '*': { input: 0, output: 0 }
  },
  lmstudio: {
    '*': { input: 0, output: 0 }
  },
  cloudflare: {
    '*': { input: 0, output: 0 }
  },
  ovh: {
    '*': { input: 0, output: 0 }
  },
  hunyuan: {
    '*': { input: 0, output: 0 }
  },
  qianfan: {
    '*': { input: 0, output: 0 }
  },
  chutes: {
    '*': { input: 0, output: 0 }
  },
  venice: {
    '*': { input: 0, output: 0 }
  },
  scaleway: {
    '*': { input: 0, output: 0 }
  }
};

export function calculateCost(provider: string, model: string, usage: TokenUsage): number {
  const providerPricing = PRICING[provider];
  if (!providerPricing) return 0;
  
  const modelPricing = providerPricing[model] || providerPricing['*'] || { input: 0, output: 0 };
  return (usage.input * modelPricing.input + usage.output * modelPricing.output) / 1000;
}

export function estimateTokens(text: string): number {
  // Rough estimation: ~4 chars per token for English, ~2 for code
  return Math.ceil(text.length / 3.5);
}

export function createUsage(inputText: string, outputText: string): TokenUsage {
  return {
    input: estimateTokens(inputText),
    output: estimateTokens(outputText),
    total: estimateTokens(inputText) + estimateTokens(outputText)
  };
}

export function formatUsage(usage: TokenUsage): string {
  return `${usage.input.toLocaleString()} → ${usage.output.toLocaleString()} (${usage.total.toLocaleString()} total)`;
}