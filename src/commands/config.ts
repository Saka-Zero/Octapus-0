import { Command } from 'commander';
import chalk from 'chalk';
import * as yaml from 'js-yaml';
import { loadConfig, saveConfig, getConfigPath, resetConfig, maskApiKey as maskApiKeyUtil } from '../config';

export function createConfigCommand(): Command {
  const cmd = new Command('config')
    .alias('cfg')
    .description('Manage configuration')
    .addCommand(createSetCommand())
    .addCommand(createGetCommand())
    .addCommand(createListCommand())
    .addCommand(createEditCommand())
    .addCommand(createResetCommand())
    .addCommand(createPathCommand());

  return cmd;
}

function createSetCommand(): Command {
  return new Command('set')
    .description('Set configuration value')
    .argument('<key>', 'Config key (e.g., providers.groq.apiKey, defaultModel)')
    .argument('<value>', 'Value to set')
    .action((key, value) => {
      const config = loadConfig();
      setNestedValue(config, key, parseValue(value));
      saveConfig(config);
      console.log(chalk.green(`✓ Set ${key} = ${maskSensitive(key, value)}`));
    });
}

function createGetCommand(): Command {
  return new Command('get')
    .description('Get configuration value')
    .argument('<key>', 'Config key')
    .action((key) => {
      const config = loadConfig();
      const value = getNestedValue(config, key);
      if (value === undefined) {
        console.log(chalk.yellow(`Key not found: ${key}`));
        return;
      }
      console.log(maskSensitive(key, value));
    });
}

function createListCommand(): Command {
  return new Command('list')
    .alias('ls')
    .description('List all configuration')
    .option('-p, --plain', 'Show plain values (unmasked)')
    .action((options) => {
      const config = loadConfig();
      const display = options.plain ? config : maskConfig(config);
      console.log(yaml.dump(display, { lineWidth: 120 }));
    });
}

function createEditCommand(): Command {
  return new Command('edit')
    .description('Open config file in editor')
    .action(() => {
      const configPath = getConfigPath();
      console.log(chalk.cyan(`Config file: ${configPath}`));
      console.log(chalk.gray('Run: code ' + configPath + '  (or your editor)'));
    });
}

function createResetCommand(): Command {
  return new Command('reset')
    .description('Reset configuration to defaults')
    .option('-y, --yes', 'Skip confirmation')
    .action((options) => {
      if (!options.yes) {
        console.log(chalk.yellow('This will reset ALL settings. Use --yes to confirm.'));
        return;
      }
      resetConfig();
      console.log(chalk.green('✓ Configuration reset to defaults'));
    });
}

function createPathCommand(): Command {
  return new Command('path')
    .description('Show config file path')
    .action(() => {
      console.log(getConfigPath());
    });
}

function setNestedValue(obj: any, path: string, value: any): void {
  const keys = path.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!current[keys[i]]) current[keys[i]] = {};
    current = current[keys[i]];
  }
  current[keys[keys.length - 1]] = value;
}

function getNestedValue(obj: any, path: string): any {
  const keys = path.split('.');
  let current = obj;
  for (const key of keys) {
    if (current === undefined || current === null) return undefined;
    current = current[key];
  }
  return current;
}

function parseValue(value: string): any {
  // Try to parse as JSON first
  try {
    return JSON.parse(value);
  } catch {}
  
  // Parse booleans
  if (value === 'true') return true;
  if (value === 'false') return false;
  
  // Parse numbers
  if (/^\d+$/.test(value)) return parseInt(value);
  if (/^\d*\.\d+$/.test(value)) return parseFloat(value);
  
  return value;
}

function maskSensitive(key: string, value: any): string {
  const sensitiveKeys = ['apiKey', 'key', 'secret', 'token', 'password'];
  if (sensitiveKeys.some(k => key.toLowerCase().includes(k.toLowerCase()))) {
    return typeof value === 'string' ? maskApiKeyUtil(value) : '****';
  }
  return String(value);
}

function maskConfig(config: any): any {
  const masked = JSON.parse(JSON.stringify(config));
  if (masked.providers) {
    for (const provider of Object.values(masked.providers) as any[]) {
      if (provider.apiKey) provider.apiKey = maskApiKeyUtil(provider.apiKey);
    }
  }
  return masked;
}