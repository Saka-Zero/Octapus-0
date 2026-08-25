#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig } from './config';
import { Router } from './router';
import { BUILTIN_PROVIDERS, createBuiltinProvider, OpenAICompatibleProvider } from './providers';
import { createChatCommand } from './commands/chat';
import { createConfigCommand } from './commands/config';
import { createModelsCommand } from './commands/models';
import { createProviderCommand } from './commands/provider';
import { runSetup } from './commands/setup';

const program = new Command();
const config = loadConfig();
const router = new Router();

// Register providers based on config
function registerProviders(): void {
  // Built-in providers (all OpenAI-compatible via the unified engine)
  for (const def of BUILTIN_PROVIDERS) {
    const provider = createBuiltinProvider(def, (config.providers as any)[def.name]);
    if (provider) router.register(provider);
  }

  // Register any custom providers (added via `provider add`)
  const knownProviders = new Set(BUILTIN_PROVIDERS.map((b) => b.name));
  for (const [name, cfg] of Object.entries(config.providers)) {
    if (knownProviders.has(name)) continue;
    if (!cfg?.enabled || !cfg.baseURL) continue;
    router.register(new OpenAICompatibleProvider(name, cfg.apiKey || 'none', cfg.baseURL, cfg.priority ?? 1));
  }
}

registerProviders();

// CLI Setup
program
  .name('octapus')
  .alias('oct')
  .description('Octapus-0: Multi-provider AI CLI with smart fallback + agent mode')
  .version('0.1.0')
  .addHelpText('after', `
Examples:
  $ octapus chat "Hello, world!"
  $ octapus chat -m gemini-3.6-flash "Explain quantum computing"
  $ octapus chat                     # interactive TUI (/help inside)
  $ octapus setup                    # provider & API key wizard
  $ octapus models --available
  $ octapus provider enable groq
  $ octapus config set providers.groq.apiKey "gsk_xxx"

Config file: ~/.config/octapus/config.yaml
`);

// Add commands
program.addCommand(createChatCommand(router));
program.addCommand(createConfigCommand());
program.addCommand(createModelsCommand(router));
program.addCommand(createProviderCommand(router));

// Interactive setup wizard
program
  .command('setup')
  .alias('init')
  .description('Interactive setup wizard — configure providers & API keys')
  .action(async () => {
    await runSetup(router);
  });

// Global options
program
  .option('-v, --verbose', 'Verbose output')
  .option('--no-color', 'Disable colored output')
  .hook('preAction', (thisCommand) => {
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
