import { Command } from 'commander';
import chalk from 'chalk';
import { Router } from '../router';
import { loadConfig, saveConfig, maskApiKey } from '../config';
import { createSpinner, formatCost, formatDuration, formatUsage } from '../utils';
import { Message } from '../providers';

export function createChatCommand(router: Router): Command {
  const cmd = new Command('chat')
    .alias('c')
    .description('Chat with AI')
    .argument('<prompt>', 'Prompt to send')
    .option('-m, --model <model>', 'Model to use')
    .option('-s, --system <prompt>', 'System prompt')
    .option('-t, --temperature <value>', 'Temperature (0-2)', parseFloat)
    .option('--max-tokens <value>', 'Max tokens', parseInt)
    .option('--no-stream', 'Disable streaming')
    .option('--no-fallback', 'Disable fallback to other providers')
    .action(async (prompt, options) => {
      const config = loadConfig();
      
      // Check if any provider is enabled
      const enabledProviders = Object.entries(config.providers)
        .filter(([_, cfg]) => cfg.enabled)
        .map(([name, cfg]) => ({ name, hasKey: !!cfg.apiKey || name === 'ollama' }));
      
      if (enabledProviders.length === 0) {
        console.log(chalk.red('No providers enabled!'));
        console.log();
        console.log(chalk.cyan('Enable at least one provider:'));
        console.log(chalk.gray('  octapus provider enable groq'));
        console.log(chalk.gray('  octapus provider enable gemini'));
        console.log(chalk.gray('  octapus provider enable ollama'));
        console.log();
        console.log(chalk.cyan('Then set your API key:'));
        console.log(chalk.gray('  octapus config set providers.groq.apiKey "gsk_xxx"'));
        process.exit(1);
      }

      // Check if any enabled provider has API key
      const readyProviders = enabledProviders.filter(p => p.hasKey);
      if (readyProviders.length === 0) {
        const missingKeys = enabledProviders.filter(p => !p.hasKey).map(p => p.name);
        console.log(chalk.red('Provider(s) enabled but API key missing: ' + missingKeys.join(', ')));
        console.log();
        console.log(chalk.cyan('Set your API key:'));
        for (const name of missingKeys) {
          if (name === 'ollama') {
            console.log(chalk.gray('  Ollama needs to be running locally: ollama serve'));
          } else {
            console.log(chalk.gray(`  octapus config set providers.${name}.apiKey "your-key"`));
          }
        }
        console.log();
        console.log(chalk.cyan('Get API keys:'));
        console.log(chalk.gray('  Groq:       https://console.groq.com/keys'));
        console.log(chalk.gray('  Cerebras:   https://cloud.cerebras.ai/'));
        console.log(chalk.gray('  Gemini:     https://aistudio.google.com/apikey'));
        console.log(chalk.gray('  SambaNova:  https://cloud.sambanova.ai/'));
        console.log(chalk.gray('  Together:   https://api.together.xyz/'));
        console.log(chalk.gray('  OpenRouter: https://openrouter.ai/keys'));
        console.log(chalk.gray('  Novita:     https://novita.ai/'));
        process.exit(1);
      }

      const model = options.model || config.defaultModel;
      const spinner = createSpinner({ text: `Connecting to ${model}...` });
      
      const messages: Message[] = [];
      if (options.system) {
        messages.push({ role: 'system', content: options.system });
      }
      messages.push({ role: 'user', content: prompt });

      const startTime = Date.now();
      let fullResponse = '';
      let inputTokens = 0;
      let outputTokens = 0;
      let providerUsed = '';
      let modelUsed = '';

      try {
        spinner.start();
        
        const fallbackModels = options.fallback ? config.fallbackModels : [];
        
        for await (const chunk of router.chat({
          model,
          messages,
          options: {
            model,
            temperature: options.temperature ?? config.settings.temperature,
            maxTokens: options.maxTokens ?? config.settings.maxTokens,
            stream: options.stream ?? config.settings.stream
          },
          fallbackModels
        })) {
          if (!providerUsed) {
            // We can't easily know which provider succeeded without modifying router
            // For now, we'll track after first chunk
          }
          spinner.stop();
          process.stdout.write(chalk.green(chunk));
          fullResponse += chunk;
        }
        
        console.log(); // New line after streaming
        
        // Estimate tokens
        inputTokens = prompt.length / 3.5;
        outputTokens = fullResponse.length / 3.5;
        
        const duration = Date.now() - startTime;
        
        // Show stats
        if (config.settings.showTokens || config.settings.showCost) {
          console.log(chalk.gray('─'.repeat(50)));
          if (config.settings.showTokens) {
            console.log(chalk.gray(`  ${formatUsage({ input: Math.round(inputTokens), output: Math.round(outputTokens), total: Math.round(inputTokens + outputTokens) })}`));
          }
          if (config.settings.showCost) {
            // We'd need to know which provider was used for accurate cost
            console.log(chalk.gray(`  Time: ${formatDuration(duration)}`));
          }
        }
        
      } catch (err) {
        spinner.fail(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      }
    });

  return cmd;
}