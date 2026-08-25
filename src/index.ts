#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig, saveConfig } from './config';
import { Router } from './router';
import { GroqProvider } from './providers/groq';
import { GeminiProvider } from './providers/gemini';
import { OllamaProvider } from './providers/ollama';
import { OpenRouterProvider } from './providers/openrouter';
import { RequestyProvider } from './providers/requesty';
import { CerebrasProvider } from './providers/cerebras';
import { SambaNovaProvider } from './providers/sambanova';
import { TogetherProvider } from './providers/together';
import { NovitaProvider } from './providers/novita';
import { OpenAICompatibleProvider } from './providers/openai-compatible';
import { createChatCommand } from './commands/chat';
import { createConfigCommand } from './commands/config';
import { createModelsCommand } from './commands/models';
import { createProviderCommand } from './commands/provider';

const program = new Command();
const config = loadConfig();
const router = new Router();

// Register providers based on config
function registerProviders(): void {
  // Groq
  if (config.providers.groq?.enabled && config.providers.groq.apiKey) {
    router.register(new GroqProvider(config.providers.groq.apiKey, config.providers.groq.baseURL));
  }

  // Cerebras
  if (config.providers.cerebras?.enabled && config.providers.cerebras.apiKey) {
    router.register(new CerebrasProvider(config.providers.cerebras.apiKey, config.providers.cerebras.baseURL));
  }

  // Gemini
  if (config.providers.gemini?.enabled && config.providers.gemini.apiKey) {
    router.register(new GeminiProvider(config.providers.gemini.apiKey, config.providers.gemini.baseURL));
  }

  // SambaNova
  if (config.providers.sambanova?.enabled && config.providers.sambanova.apiKey) {
    router.register(new SambaNovaProvider(config.providers.sambanova.apiKey, config.providers.sambanova.baseURL));
  }

  // Ollama (no key needed)
  if (config.providers.ollama?.enabled) {
    router.register(new OllamaProvider(config.providers.ollama.baseURL));
  }

  // Together
  if (config.providers.together?.enabled && config.providers.together.apiKey) {
    router.register(new TogetherProvider(config.providers.together.apiKey, config.providers.together.baseURL));
  }

  // OpenRouter
  if (config.providers.openrouter?.enabled && config.providers.openrouter.apiKey) {
    router.register(new OpenRouterProvider(config.providers.openrouter.apiKey, config.providers.openrouter.baseURL));
  }

  // Novita
  if (config.providers.novita?.enabled && config.providers.novita.apiKey) {
    router.register(new NovitaProvider(config.providers.novita.apiKey, config.providers.novita.baseURL));
  }

  // Requesty
  if (config.providers.requesty?.enabled && config.providers.requesty.apiKey) {
    router.register(new RequestyProvider(config.providers.requesty.apiKey, config.providers.requesty.baseURL));
  }

  // ─── Free-tier providers (OpenAI-compatible) ─────────────────────
  const freeProviders: Array<{
    name: string;
    baseURL: string;
    priority: number;
    models: string[];
    needsKey: boolean;
  }> = [
    {
      name: 'github-models',
      baseURL: 'https://models.inference.ai.azure.com',
      priority: 6,
      needsKey: true,
      models: ['gpt-4o', 'gpt-4o-mini', 'o3-mini', 'Meta-Llama-3.1-405B-Instruct', 'Phi-4']
    },
    {
      name: 'mistral',
      baseURL: 'https://api.mistral.ai/v1',
      priority: 6,
      needsKey: true,
      models: ['mistral-large-latest', 'mistral-small-latest', 'codestral-latest', 'ministral-8b-latest']
    },
    {
      name: 'nvidia',
      baseURL: 'https://integrate.api.nvidia.com/v1',
      priority: 5,
      needsKey: true,
      models: ['meta/llama-3.3-70b-instruct', 'nvidia/llama-3.1-nemotron-70b-instruct', 'deepseek-ai/deepseek-r1', 'qwen/qwen2.5-coder-32b-instruct']
    },
    {
      name: 'cohere',
      baseURL: 'https://api.cohere.ai/compatibility/v1',
      priority: 5,
      needsKey: true,
      models: ['command-r-plus-08-2024', 'command-r-08-2024', 'command-r7b-12-2024']
    },
    {
      name: 'huggingface',
      baseURL: 'https://router.huggingface.co/v1',
      priority: 4,
      needsKey: true,
      models: ['Qwen/Qwen2.5-72B-Instruct', 'meta-llama/Llama-3.3-70B-Instruct', 'deepseek-ai/DeepSeek-V3']
    },
    {
      name: 'zhipu',
      baseURL: 'https://open.bigmodel.cn/api/paas/v4',
      priority: 3,
      needsKey: true,
      models: ['glm-4-flash', 'glm-4-plus', 'glm-4-air', 'codegeex-4']
    },
    {
      name: 'siliconflow',
      baseURL: 'https://api.siliconflow.cn/v1',
      priority: 2,
      needsKey: true,
      models: ['Qwen/Qwen2.5-7B-Instruct', 'THUDM/glm-4-9b-chat', 'deepseek-ai/DeepSeek-V3']
    },
    {
      name: 'modelscope',
      baseURL: 'https://api-inference.modelscope.cn/v1',
      priority: 2,
      needsKey: true,
      models: ['Qwen/Qwen2.5-72B-Instruct', 'Qwen/Qwen2.5-Coder-32B-Instruct']
    },
    {
      // Zero-setup: works without any API key
      name: 'pollinations',
      baseURL: 'https://text.pollinations.ai/openai',
      priority: 1,
      needsKey: false,
      models: ['openai', 'openai-fast', 'mistral', 'llama', 'qwen-coder']
    }
  ];

  for (const fp of freeProviders) {
    const cfg = config.providers[fp.name];
    if (!cfg?.enabled) continue;
    if (fp.needsKey && !cfg.apiKey) continue;
    router.register(
      new OpenAICompatibleProvider(
        fp.name,
        cfg.apiKey || 'none',
        cfg.baseURL || fp.baseURL,
        cfg.priority ?? fp.priority,
        fp.models
      )
    );
  }

  // Register any custom providers (added via `provider add`)
  const knownProviders = ['groq', 'cerebras', 'gemini', 'sambanova', 'ollama', 'together', 'openrouter', 'novita', 'requesty', ...freeProviders.map(f => f.name)];
  for (const [name, cfg] of Object.entries(config.providers)) {
    if (knownProviders.includes(name)) continue;
    if (!cfg?.enabled || !cfg.apiKey || !cfg.baseURL) continue;
    // Create a generic OpenAI-compatible provider
    router.register(new OpenAICompatibleProvider(name, cfg.apiKey, cfg.baseURL, cfg.priority ?? 1));
  }
}

registerProviders();

// CLI Setup
program
  .name('octapus')
  .alias('oct')
  .description('Octapus-0: Multi-provider AI CLI with smart fallback')
  .version('0.1.0')
  .addHelpText('after', `
Examples:
  $ octapus chat "Hello, world!"
  $ octapus chat -m gemini-1.5-pro-latest "Explain quantum computing"
  $ octapus chat --system "You are a code reviewer" "Review this code..."
  $ octapus models --available
  $ octapus provider enable groq
  $ octapus config set providers.groq.apiKey "gsk_xxx"
  $ octapus config list

Config file: ~/.config/octapus/config.yaml
`);

// Add commands
program.addCommand(createChatCommand(router));
program.addCommand(createConfigCommand());
program.addCommand(createModelsCommand(router));
program.addCommand(createProviderCommand(router));

// Global options
program
  .option('-v, --verbose', 'Verbose output')
  .option('--no-color', 'Disable colored output')
  .hook('preAction', (thisCommand, actionCommand) => {
    if (thisCommand.opts().noColor) {
      chalk.level = 0;
    }
  });

// Parse
program.parse(process.argv);

// Show help if no args
if (process.argv.length <= 2) {
  program.help();
}