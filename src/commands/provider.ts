import { Command } from 'commander';
import chalk from 'chalk';
import { Router } from '../router';
import { loadConfig, saveConfig } from '../config';

export function createProviderCommand(router: Router): Command {
  const cmd = new Command('provider')
    .alias('p')
    .description('Manage providers')
    .addCommand(createEnableCommand())
    .addCommand(createDisableCommand())
    .addCommand(createTestCommand(router))
    .addCommand(createPriorityCommand())
    .addCommand(createAddCommand());

  return cmd;
}

function createEnableCommand(): Command {
  return new Command('enable')
    .description('Enable a provider')
    .argument('<name>', 'Provider name (groq, gemini, ollama, openrouter, requesty)')
    .action((name) => {
      const config = loadConfig();
      if (!config.providers[name]) {
        console.log(chalk.red(`Unknown provider: ${name}`));
        return;
      }
      config.providers[name].enabled = true;
      saveConfig(config);
      console.log(chalk.green(`✓ Enabled ${name}`));
    });
}

function createDisableCommand(): Command {
  return new Command('disable')
    .description('Disable a provider')
    .argument('<name>', 'Provider name')
    .action((name) => {
      const config = loadConfig();
      if (!config.providers[name]) {
        console.log(chalk.red(`Unknown provider: ${name}`));
        return;
      }
      config.providers[name].enabled = false;
      saveConfig(config);
      console.log(chalk.yellow(`✓ Disabled ${name}`));
    });
}

function createTestCommand(router: Router): Command {
  return new Command('test')
    .description('Test provider API key')
    .argument('[name]', 'Provider name (test all if omitted)')
    .action(async (name) => {
      const config = loadConfig();
      const providersToTest = name ? [name] : Object.keys(config.providers).filter(p => config.providers[p].enabled);
      
      if (providersToTest.length === 0) {
        console.log(chalk.yellow('No enabled providers to test'));
        return;
      }

      console.log(chalk.cyan('Testing provider connections...'));
      console.log();

      for (const pName of providersToTest) {
        const provider = router.getProviderForModel(config.providers[pName]?.models?.[0] || '');
        if (!provider) {
          console.log(chalk.gray(`  ${pName}: Not registered`));
          continue;
        }

        process.stdout.write(`  ${pName}: `);
        try {
          const valid = await provider.validateKey();
          if (valid) {
            console.log(chalk.green('✓ Connected'));
          } else {
            console.log(chalk.red('✗ Invalid key'));
          }
        } catch (err) {
          console.log(chalk.red(`✗ Error: ${err instanceof Error ? err.message : String(err)}`));
        }
      }
    });
}

function createPriorityCommand(): Command {
  return new Command('priority')
    .description('Set provider priority (higher = tried first)')
    .argument('<name>', 'Provider name')
    .argument('<priority>', 'Priority number (0-100)', parseInt)
    .action((name, priority) => {
      const config = loadConfig();
      if (!config.providers[name]) {
        console.log(chalk.red(`Unknown provider: ${name}`));
        return;
      }
      config.providers[name].priority = priority;
      saveConfig(config);
      console.log(chalk.green(`✓ Set ${name} priority to ${priority}`));
    });
}

function createAddCommand(): Command {
  return new Command('add')
    .description('Add custom provider (OpenAI-compatible)')
    .argument('<name>', 'Provider name')
    .argument('<baseUrl>', 'Base URL (e.g., https://api.example.com/v1)')
    .option('-k, --key <key>', 'API key')
    .option('-p, --priority <num>', 'Priority', parseInt)
    .action((name, baseUrl, options) => {
      const config = loadConfig();
      config.providers[name] = {
        baseURL: baseUrl,
        apiKey: options.key || '',
        priority: options.priority || 1,
        enabled: true
      };
      saveConfig(config);
      console.log(chalk.green(`✓ Added custom provider: ${name}`));
    });
}