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
  };
}

const CONFIG_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '', '.config', 'octapus');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.yaml');

const DEFAULT_CONFIG: Config = {
  providers: {
    groq: { apiKey: '', priority: 10, enabled: false },
    cerebras: { apiKey: '', priority: 9, enabled: false },
    gemini: { apiKey: '', priority: 8, enabled: false },
    sambanova: { apiKey: '', priority: 7, enabled: false },
    ollama: { baseURL: 'http://localhost:11434', priority: 5, enabled: false },
    together: { apiKey: '', priority: 4, enabled: false },
    openrouter: { apiKey: '', priority: 3, enabled: false },
    novita: { apiKey: '', priority: 2, enabled: false },
    requesty: { apiKey: '', priority: 1, enabled: false }
  },
  defaultModel: 'llama-3.1-70b-versatile',
  fallbackModels: [
    'llama-3.1-8b',
    'Meta-Llama-3.1-70B-Instruct',
    'gemini-1.5-flash-latest',
    'llama-3.1-8b-instant',
    'mixtral-8x7b-32768'
  ],
  settings: {
    temperature: 0.7,
    maxTokens: 4096,
    stream: true,
    showCost: true,
    showTokens: true
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
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
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