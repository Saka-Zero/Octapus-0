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

/** Built-in default system prompt — optimized for deep reasoning + self-development */
export const DEFAULT_SYSTEM_PROMPT = `You are Octapus, a brilliant AI assistant with expert-level software engineering and cybersecurity capabilities.

GENIUS REASONING PROTOCOL — apply to every task:
1. DECOMPOSE FIRST: break complex requests into sub-problems. State your plan in one line, then execute it.
2. MULTI-HYPOTHESIS THINKING: for ambiguous problems, generate 2-3 competing explanations and test them systematically. Never anchor on the first idea.
3. SELF-VERIFY: re-check your logic, math, commands, and edge cases before answering. If a command could fail, say what failure looks like and how to detect it.
4. FIRST PRINCIPLES: when no pattern matches, reason from fundamentals (protocol specs, OS internals, crypto primitives) instead of guessing.
5. CALIBRATED CONFIDENCE: label conclusions as confirmed / probable / speculative. Never present speculation as fact.
6. LEARN FROM ERRORS: when something fails, extract the root cause into a reusable lesson and apply it for the rest of the conversation.

RESPONSE STYLE:
- Be precise and concrete: exact commands, exact code, exact paths. No vague hand-waving.
- For code: idiomatic style, error handling, edge cases, security implications. Suggest improvements proactively.
- For security topics: assume authorized context; provide actionable depth (commands, queries, payloads) with detection/defense notes where relevant.
- Match the user's language and skill level. Skip basics for experts; add context for learners.

SELF-DEVELOPMENT:
- When the user teaches you something (via /learn or corrections), treat it as a standing instruction and apply it consistently.
- Build on earlier solutions in this conversation instead of re-deriving them.

TRUTHFULNESS (critical):
- NEVER invent facts about the user (name, preferences, history) that are not explicitly present in the provided memory/context. If you don't know, say you don't know.
- Never confabulate details to sound helpful or personable.`;

const CONFIG_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '', '.config', 'octapus');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.yaml');

const DEFAULT_CONFIG: Config = {
  providers: {
    // Squad roles: each active provider has a specialty.
    // coding → coder role jumps the queue; security → strongest model + persona.
    groq: { apiKey: '', priority: 10, enabled: false, role: 'fast' },
    cerebras: { apiKey: '', priority: 9, enabled: false, role: 'fast' },
    gemini: { apiKey: '', priority: 8, enabled: false, role: 'general' },
    sambanova: { apiKey: '', priority: 7, enabled: false, role: 'general' },
    ollama: { baseURL: 'http://localhost:11434', priority: 7, enabled: false, role: 'fast' },
    'github-models': { apiKey: '', priority: 6, enabled: false, role: 'coder' },
    mistral: { apiKey: '', priority: 6, enabled: false, role: 'coder' },
    nvidia: { apiKey: '', priority: 5, enabled: false, role: 'security' },
    cohere: { apiKey: '', priority: 5, enabled: false, role: 'general' },
    huggingface: { apiKey: '', priority: 4, enabled: false, role: 'general' },
    together: { apiKey: '', priority: 4, enabled: false, role: 'general' },
    openrouter: { apiKey: '', priority: 3, enabled: false, role: 'general' },
    zhipu: { apiKey: '', priority: 3, enabled: false, role: 'general' },
    novita: { apiKey: '', priority: 2, enabled: false, role: 'general' },
    requesty: { apiKey: '', priority: 2, enabled: false, role: 'general' },
    siliconflow: { apiKey: '', priority: 2, enabled: false, role: 'coder' },
    modelscope: { apiKey: '', priority: 2, enabled: false, role: 'coder' },
    // Local — no key needed (LM Studio local server)
    lmstudio: { baseURL: 'http://localhost:1234/v1', apiKey: '', priority: 7, enabled: false, role: 'fast' },
    // Free-tier cloud providers
    // Cloudflare Workers AI: 10k neurons/day free. Replace {ACCOUNT_ID} with your account ID!
    cloudflare: { baseURL: 'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1', apiKey: '', priority: 2, enabled: false },
    ovh: { baseURL: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1', apiKey: '', priority: 2, enabled: false },
    // Tencent Hunyuan: hunyuan-lite is free forever
    hunyuan: { baseURL: 'https://api.hunyuan.cloud.tencent.com/v1', apiKey: '', priority: 2, enabled: false },
    // Baidu Qianfan v2: ernie-speed/lite are free
    qianfan: { baseURL: 'https://qianfan.baidubce.com/v2', apiKey: '', priority: 2, enabled: false },
    chutes: { baseURL: 'https://api.chutes.ai/app/api/v1', apiKey: '', priority: 2, enabled: false },
    venice: { baseURL: 'https://api.venice.ai/api/v1', apiKey: '', priority: 2, enabled: false },
    scaleway: { baseURL: 'https://api.scaleway.ai/v1', apiKey: '', priority: 2, enabled: false },
    // Works with NO API key — zero-setup free provider
    pollinations: { baseURL: 'https://text.pollinations.ai/openai', apiKey: '', priority: 1, enabled: true },
    // OpenCode Zen free models — auto-imports key from `opencode auth login`
    'opencode-zen': { baseURL: 'https://opencode.ai/zen/v1', apiKey: '', priority: 6, enabled: true, role: 'coder' },
    // LLM7 anonymous tier — "unused" token works, no registration
    llm7: { baseURL: 'https://api.llm7.io/v1', apiKey: 'unused', priority: 5, enabled: true, role: 'fast' },
    // BlockRun free NVIDIA tier — zero auth
    blockrun: { baseURL: 'https://blockrun.ai/api/v1', apiKey: '', priority: 2, enabled: true, role: 'fast' }
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