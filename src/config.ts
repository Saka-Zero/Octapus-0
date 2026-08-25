import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { ProviderConfig } from './providers';

export interface Config {
  providers: Record<string, ProviderConfig & { priority: number; enabled: boolean }>;
  defaultModel: string;
  fallbackModels: string[];
  settings: {
    temperature: number;
    maxTokens: number;
    stream: boolean;
    showCost: boolean;
    showTokens: boolean;
    /** Custom system prompt; empty = built-in reasoning-optimized default */
    systemPrompt: string;
    /** Inject long-term memory into every request */
    useMemory: boolean;
  };
}

/** Built-in default system prompt — optimized for deep reasoning */
export const DEFAULT_SYSTEM_PROMPT = `You are Octapus, a brilliant AI assistant with expert-level reasoning.

Thinking protocol:
1. Understand the request fully before answering; ask clarifying questions only when truly ambiguous.
2. For complex problems, reason step by step internally, then present a clear, structured answer.
3. Verify your own logic before responding — check edge cases, math, and assumptions.
4. Be precise and concrete: exact commands, code, numbers. No vague hand-waving.
5. Admit uncertainty honestly instead of inventing facts.`;

const CONFIG_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '', '.config', 'octapus');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.yaml');

const DEFAULT_CONFIG: Config = {
  providers: {
    groq: { apiKey: '', priority: 10, enabled: false },
    cerebras: { apiKey: '', priority: 9, enabled: false },
    gemini: { apiKey: '', priority: 8, enabled: false },
    sambanova: { apiKey: '', priority: 7, enabled: false },
    ollama: { baseURL: 'http://localhost:11434', priority: 7, enabled: false },
    'github-models': { apiKey: '', priority: 6, enabled: false },
    mistral: { apiKey: '', priority: 6, enabled: false },
    nvidia: { apiKey: '', priority: 5, enabled: false },
    cohere: { apiKey: '', priority: 5, enabled: false },
    huggingface: { apiKey: '', priority: 4, enabled: false },
    together: { apiKey: '', priority: 4, enabled: false },
    openrouter: { apiKey: '', priority: 3, enabled: false },
    zhipu: { apiKey: '', priority: 3, enabled: false },
    novita: { apiKey: '', priority: 2, enabled: false },
    requesty: { apiKey: '', priority: 2, enabled: false },
    siliconflow: { apiKey: '', priority: 2, enabled: false },
    modelscope: { apiKey: '', priority: 2, enabled: false },
    // Works with NO API key — zero-setup free provider
    pollinations: { baseURL: 'https://text.pollinations.ai/openai', apiKey: '', priority: 1, enabled: true }
  },
  defaultModel: 'llama-3.3-70b-versatile',
  fallbackModels: [
    'llama-3.1-8b-instant',
    'Meta-Llama-3.1-70B-Instruct',
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'meta-llama/llama-4-scout:free'
  ],
  settings: {
    temperature: 0.7,
    maxTokens: 4096,
    stream: true,
    showCost: true,
    showTokens: true,
    systemPrompt: '',
    useMemory: true
  }
};

export function loadConfig(): Config {
  if (!fs.existsSync(CONFIG_FILE)) {
    return DEFAULT_CONFIG;
  }
  
  try {
    const content = fs.readFileSync(CONFIG_FILE, 'utf8');
    const loaded = yaml.load(content) as Partial<Config>;
    return deepMerge(DEFAULT_CONFIG, loaded);
  } catch (err) {
    // Warn user about invalid config but don't crash
    console.warn(`Warning: Invalid config file at ${CONFIG_FILE}, using defaults`);
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(config: Config): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  
  const content = yaml.dump(config, { lineWidth: 120, noRefs: true });
  fs.writeFileSync(CONFIG_FILE, content, { mode: 0o600 });
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}

export function resetConfig(): Config {
  saveConfig(DEFAULT_CONFIG);
  return DEFAULT_CONFIG;
}

function deepMerge(target: any, source: any): any {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    // Skip null/undefined values from YAML so defaults survive
    if (source[key] === null || source[key] === undefined) continue;
    if (typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

export function maskApiKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '****';
  return key.slice(0, 4) + '****' + key.slice(-4);
}