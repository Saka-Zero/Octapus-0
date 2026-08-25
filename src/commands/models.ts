import { Command } from 'commander';
import chalk from 'chalk';
import { Router } from '../router';
import { loadConfig } from '../config';

export function createModelsCommand(router: Router): Command {
  const cmd = new Command('models')
    .alias('m')
    .description('List available models')
    .option('-p, --provider <name>', 'Filter by provider')
    .option('-a, --available', 'Show only models from validated providers')
    .action(async (options) => {
      const config = loadConfig();
      
      if (options.available) {
        console.log(chalk.cyan('Validating provider keys...'));
        const results = await router.validateAllKeys();
        const validProviders = Object.entries(results)
          .filter(([, valid]) => valid)
          .map(([name]) => name);
        
        if (validProviders.length === 0) {
          console.log(chalk.yellow('No providers with valid keys found.'));
          return;
        }
        
        console.log(chalk.green(`Valid providers: ${validProviders.join(', ')}`));
        console.log();
      }

      const status = router.getProviderStatus();
      const allModels = router.getAvailableModels();

      if (options.provider) {
        const provider = status[options.provider];
        if (!provider) {
          console.log(chalk.red(`Provider not found: ${options.provider}`));
          return;
        }
        printProviderModels(options.provider, provider, config);
        return;
      }

      // Print all providers
      for (const [name, provider] of Object.entries(status)) {
        printProviderModels(name, provider, config);
      }

      // Summary
      console.log(chalk.gray('─'.repeat(50)));
      console.log(chalk.gray(`Total models: ${allModels.length}`));
      console.log(chalk.gray(`Providers: ${Object.keys(status).length}`));

      // Show known-but-disabled providers for discoverability
      const disabled = Object.keys(config.providers).filter((n) => !status[n]);
      if (disabled.length > 0) {
        console.log();
        console.log(chalk.cyan('Available to enable:') + chalk.gray('  (oct provider enable <name> && oct config set providers.<name>.apiKey <key>)'));
        for (const name of disabled) {
          const needsKey = name !== 'ollama' && name !== 'pollinations';
          const hint = needsKey ? '' : chalk.green('  ← no key needed!');
          console.log(chalk.gray(`  ○ ${name}${hint}`));
        }
      }
    });

  return cmd;
}

function printProviderModels(name: string, provider: any, config: any): void {
  const cfg = config.providers[name];
  const enabled = cfg?.enabled ? chalk.green('●') : chalk.red('○');
  const priority = cfg?.priority ?? 0;
  const hasKey = cfg?.apiKey || cfg?.baseURL ? chalk.green('✓') : chalk.red('✗');
  
  console.log(`${enabled} ${chalk.bold(name)} ${chalk.gray(`(priority: ${priority}, key: ${hasKey})`)}`);
  
  if (provider.models.length === 0) {
    console.log(chalk.gray('  No models loaded'));
  } else {
    for (const model of provider.models) {
      const isDefault = config.defaultModel === model ? chalk.yellow(' ★') : '';
      console.log(`  ${chalk.cyan(model)}${isDefault}`);
    }
  }
  console.log();
}