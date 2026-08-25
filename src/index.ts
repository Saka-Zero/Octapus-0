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

  // Register any custom providers (added via `provider add`)
  const knownProviders = ['groq', 'cerebras', 'gemini', 'sambanova', 'ollama', 'together', 'openrouter', 'novita', 'requesty'];
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