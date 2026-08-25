import * as fs from 'fs';
import * as path from 'path';
import { Provider, ProviderConfig, Message, ChatOptions, StreamEvent, Tool, ToolCall, RouterOptions } from './base';
import { OpenAICompatibleProvider } from './openai-compatible';

export { Provider, Message, ChatOptions, Tool, ToolCall, ProviderConfig, RouterOptions, StreamEvent } from './base';
export { OpenAICompatibleProvider } from './openai-compatible';
export type { Provider as IProvider } from './base';

export interface BuiltinProviderDef {
  name: string;
  baseURL: string;
  priority: number;
  models: string[];
  needsKey: boolean;
  note?: string;
}

/**
 * All 26 built-in providers. Every one speaks the OpenAI protocol —
 * Gemini and Ollama via their official compatibility endpoints.
 */
export const BUILTIN_PROVIDERS: BuiltinProviderDef[] = [
  { name: 'groq', baseURL: 'https://api.groq.com/openai/v1', priority: 10, needsKey: true,
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'gemma2-9b-it'] },
  { name: 'cerebras', baseURL: 'https://api.cerebras.ai/v1', priority: 9, needsKey: true,
    models: ['llama3.1-70b', 'llama3.1-8b'] },
  { name: 'gemini', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', priority: 8, needsKey: true,
    models: ['gemini-3.6-flash', 'gemini-3.6-pro', 'gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemma-3-27b-it', 'gemma-3-12b-it'] },
  { name: 'sambanova', baseURL: 'https://api.sambanova.ai/v1', priority: 7, needsKey: true,
    models: ['Meta-Llama-3.1-70B-Instruct', 'Meta-Llama-3.1-8B-Instruct'] },
  { name: 'ollama', baseURL: 'http://localhost:11434/v1', priority: 7, needsKey: false, models: [] },
  { name: 'github-models', baseURL: 'https://models.inference.ai.azure.com', priority: 6, needsKey: true,
    models: ['gpt-4o', 'gpt-4o-mini', 'o3-mini', 'Meta-Llama-3.1-405B-Instruct', 'Phi-4'] },
  { name: 'mistral', baseURL: 'https://api.mistral.ai/v1', priority: 6, needsKey: true,
    models: ['mistral-large-latest', 'mistral-small-latest', 'codestral-latest', 'ministral-8b-latest'] },
  { name: 'nvidia', baseURL: 'https://integrate.api.nvidia.com/v1', priority: 5, needsKey: true,
    models: ['meta/llama-3.3-70b-instruct', 'nvidia/llama-3.1-nemotron-70b-instruct', 'deepseek-ai/deepseek-r1', 'qwen/qwen2.5-coder-32b-instruct'] },
  { name: 'cohere', baseURL: 'https://api.cohere.ai/compatibility/v1', priority: 5, needsKey: true,
    models: ['command-r-plus-08-2024', 'command-r-08-2024', 'command-r7b-12-2024'] },
  { name: 'huggingface', baseURL: 'https://router.huggingface.co/v1', priority: 4, needsKey: true,
    models: ['Qwen/Qwen2.5-72B-Instruct', 'meta-llama/Llama-3.3-70B-Instruct', 'deepseek-ai/DeepSeek-V3'] },
  { name: 'together', baseURL: 'https://api.together.xyz/v1', priority: 4, needsKey: true,
    models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo-Free', 'deepseek-ai/DeepSeek-R1-Distill-Llama-70B-free',
      'meta-llama/Llama-3.1-8B-Instruct-Turbo', 'meta-llama/Llama-3.1-70B-Instruct-Turbo',
      'mistralai/Mixtral-8x7B-Instruct-v0.1', 'google/gemma-2-9b-it', 'Qwen/Qwen2.5-72B-Instruct-Turbo'] },
  { name: 'openrouter', baseURL: 'https://openrouter.ai/api/v1', priority: 3, needsKey: true,
    models: ['meta-llama/llama-4-scout:free', 'google/gemma-3-27b-it:free', 'deepseek/deepseek-chat-v3-0324:free', 'qwen/qwen3-235b-a22b:free', 'microsoft/mai-ds-r1:free'],
    note: 'Requires HTTP-Referer header' },
  { name: 'zhipu', baseURL: 'https://open.bigmodel.cn/api/paas/v4', priority: 3, needsKey: true,
    models: ['glm-4-flash', 'glm-4-plus', 'glm-4-air', 'codegeex-4'] },
  { name: 'novita', baseURL: 'https://api.novita.ai/v3/openai', priority: 2, needsKey: true,
    models: ['meta-llama/llama-3.1-8b-instruct', 'meta-llama/llama-3.1-70b-instruct', 'deepseek/deepseek-r1', 'qwen/qwen-2.5-72b-instruct'] },
  { name: 'requesty', baseURL: 'https://router.requesty.ai/v1', priority: 2, needsKey: true,
    models: ['meta-llama/llama-4-scout:free', 'google/gemma-3-27b-it:free', 'deepseek/deepseek-chat-v3-0324:free'] },
  { name: 'siliconflow', baseURL: 'https://api.siliconflow.cn/v1', priority: 2, needsKey: true,
    models: ['Qwen/Qwen2.5-7B-Instruct', 'THUDM/glm-4-9b-chat', 'deepseek-ai/DeepSeek-V3'] },
  { name: 'modelscope', baseURL: 'https://api-inference.modelscope.cn/v1', priority: 2, needsKey: true,
    models: ['Qwen/Qwen2.5-72B-Instruct', 'Qwen/Qwen2.5-Coder-32B-Instruct'] },
  { name: 'lmstudio', baseURL: 'http://localhost:1234/v1', priority: 7, needsKey: false, models: [] },
  // Cloudflare requires the user's account ID inside the URL
  { name: 'cloudflare', baseURL: 'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1', priority: 2, needsKey: true,
    models: ['@cf/meta/llama-3.1-8b-instruct', '@cf/qwen/qwen2.5-coder-32b-instruct', '@cf/mistralai/mistral-small-3.1-24b-instruct'] },
  { name: 'ovh', baseURL: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1', priority: 2, needsKey: true,
    models: ['Meta-Llama-3_1-8B-Instruct', 'Qwen2_5-72B-Instruct', 'Mistral-Nemo-Instruct-2407'] },
  { name: 'hunyuan', baseURL: 'https://api.hunyuan.cloud.tencent.com/v1', priority: 2, needsKey: true,
    models: ['hunyuan-lite', 'hunyuan-turbo', 'hunyuan-standard'] },
  { name: 'qianfan', baseURL: 'https://qianfan.baidubce.com/v2', priority: 2, needsKey: true,
    models: ['ernie-speed-8k', 'ernie-lite-8k', 'ernie-speed-128k'] },
  { name: 'chutes', baseURL: 'https://api.chutes.ai/app/api/v1', priority: 2, needsKey: true,
    models: ['deepseek-ai/DeepSeek-R1', 'Qwen/Qwen2.5-72B-Instruct', 'meta-llama/Llama-3.3-70B-Instruct'] },
  { name: 'venice', baseURL: 'https://api.venice.ai/api/v1', priority: 2, needsKey: true,
    models: ['llama-3.3-70b', 'qwen-2.5-qwq-32b', 'dolphin-mixtral-8x22b'] },
  { name: 'scaleway', baseURL: 'https://api.scaleway.ai/v1', priority: 2, needsKey: true,
    models: ['qwen2.5-72b-instruct', 'llama-3.1-8b-instruct', 'mistral-nemo-instruct-2407'] },
  { name: 'pollinations', baseURL: 'https://text.pollinations.ai/openai', priority: 1, needsKey: false,
    // Verified alive keyless (2026-08): legacy API retired most named models
    models: ['openai', 'openai-fast'] },
  // OpenCode Zen — official "use with any agent" gateway. Free models below;
  // key comes from `opencode auth login` (auto-imported) or OPENCODE_API_KEY.
  { name: 'opencode-zen', baseURL: 'https://opencode.ai/zen/v1', priority: 6, needsKey: true,
    models: ['deepseek-v4-flash-free', 'nemotron-3-ultra-free', 'nemotron-3.5-lightning-free',
      'minimax-m3-free' as string, 'mimo-v2.5-free', 'hy3-free', 'laguna-s-2.1-free',
      'x-preview-f-free', 'big-pickle'].filter(Boolean) }
];

// minimax-m3-free verified via public /models listing
BUILTIN_PROVIDERS[BUILTIN_PROVIDERS.length - 1].models.push('qwen3.6-plus-free');

/**
 * Try to import an OpenCode Zen API key from a local OpenCode installation.
 * Works after the user runs `opencode auth login` once (GitHub OAuth).
 */
export function importOpencodeZenKey(): string | null {
  const candidates = [
    path.join(process.env.HOME || process.env.USERPROFILE || '', '.local', 'share', 'opencode', 'auth.json'),
    path.join(process.env.APPDATA || '', 'opencode', 'auth.json')
  ].filter(Boolean);

  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      // auth.json shape: { "<provider>": { type, key | apiKey | access_token } }
      for (const [providerId, entry] of Object.entries(data as Record<string, any>)) {
        if (!entry || typeof entry !== 'object') continue;
        const lower = providerId.toLowerCase();
        if (!lower.includes('zen') && !lower.includes('opencode')) continue;
        const token = entry.key || entry.apiKey || entry.access_token || entry.accessToken;
        if (typeof token === 'string' && token.length > 10) return token;
      }
      // Fallback: any single api-type credential
      for (const entry of Object.values(data as Record<string, any>)) {
        if (entry && typeof entry === 'object' && typeof (entry as any).key === 'string') {
          return (entry as any).key;
        }
      }
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Instantiate a built-in provider from config.
 * opencode-zen: auto-imports the key from a local OpenCode login
 * (`opencode auth login`) or the OPENCODE_API_KEY env var.
 */
export function createBuiltinProvider(def: BuiltinProviderDef, cfg: ProviderConfig & { enabled?: boolean }): OpenAICompatibleProvider | null {
  if (!cfg?.enabled) return null;

  let apiKey = cfg.apiKey || '';
  if (def.name === 'opencode-zen' && !apiKey) {
    apiKey = process.env.OPENCODE_API_KEY || importOpencodeZenKey() || '';
  }
  if (def.needsKey && !apiKey) return null;

  const extraHeaders = def.name === 'openrouter'
    ? { 'HTTP-Referer': 'https://github.com/Saka-Zero/Octapus-0', 'X-Title': 'Octapus-0' }
    : undefined;
  return new OpenAICompatibleProvider(
    def.name,
    apiKey || 'none',
    cfg.baseURL || def.baseURL,
    cfg.priority ?? def.priority,
    def.models,
    extraHeaders
  );
}
