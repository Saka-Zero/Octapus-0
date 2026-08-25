import { Command } from 'commander';
import chalk from 'chalk';
import * as readline from 'readline';
import { Router } from '../router';
import { loadConfig, saveConfig, maskApiKey } from '../config';
import { createSpinner, formatCost, formatDuration, formatUsage, estimateTokens } from '../utils';
import { Message } from '../providers';
import {
  loadSession,
  createSession,
  addMessage,
  getMessagesForApi,
  getHistoryText,
  listSessions,
  deleteSession,
  clearAllHistory,
  ConversationSession
} from '../utils/history';

export function createChatCommand(router: Router): Command {
  const cmd = new Command('chat')
    .alias('c')
    .description('Chat with AI (with conversation memory)')
    .argument('[prompt]', 'Prompt to send (omit for interactive mode)')
    .option('-m, --model <model>', 'Model to use')
    .option('-s, --system <prompt>', 'System prompt')
    .option('-t, --temperature <value>', 'Temperature (0-2)', parseFloat)
    .option('--max-tokens <value>', 'Max tokens', parseInt)
    .option('--no-stream', 'Disable streaming')
    .option('--no-fallback', 'Disable fallback to other providers')
    .option('--new', 'Start a new conversation (clear history)')
    .option('--history', 'Show recent conversation history')
    .option('--sessions', 'List all conversation sessions')
    .option('--clear', 'Clear all conversation history')
    .option('--continue <session-id>', 'Continue a specific session')
    .action(async (prompt, options) => {
      const config = loadConfig();
      
      // Handle --clear flag
      if (options.clear) {
        clearAllHistory();
        console.log(chalk.green('✓ Conversation history cleared'));
        return;
      }
      
      // Handle --sessions flag
      if (options.sessions) {
        const sessions = listSessions();
        if (sessions.length === 0) {
          console.log(chalk.yellow('No conversation sessions found.'));
          return;
        }
        
        console.log(chalk.cyan('Conversation Sessions:'));
        console.log();
        for (const session of sessions) {
          const date = session.lastActive.toLocaleDateString();
          const time = session.lastActive.toLocaleTimeString();
          const msgCount = session.messages.filter(m => m.role !== 'system').length;
          console.log(`  ${chalk.green(session.id)} ${chalk.gray(`${date} ${time}`)} ${chalk.gray(`(${msgCount} messages)`)}`);
          console.log(`    ${chalk.white(session.title)}`);
        }
        console.log();
        console.log(chalk.gray('Use --continue <session-id> to resume a session'));
        return;
      }
      
      // Handle --history flag
      if (options.history) {
        const session = loadSession();
        if (!session) {
          console.log(chalk.yellow('No active conversation session.'));
          console.log(chalk.gray('Start chatting with: octapus chat "Hello"'));
          return;
        }
        
        console.log(chalk.cyan(`Session: ${session.id}`));
        console.log(chalk.gray(`Started: ${session.startedAt.toLocaleString()}`));
        console.log(chalk.gray(`Model: ${session.model}`));
        console.log();
        console.log(getHistoryText(session, 20));
        return;
      }

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
      
      // Validate temperature and maxTokens
      if (options.temperature !== undefined) {
        if (options.temperature < 0 || options.temperature > 2) {
          console.log(chalk.red('Temperature must be between 0 and 2'));
          process.exit(1);
        }
      }
      if (options.maxTokens !== undefined) {
        if (options.maxTokens < 1 || options.maxTokens > 1000000) {
          console.log(chalk.red('Max tokens must be between 1 and 1000000'));
          process.exit(1);
        }
      }

      // Load or create session
      let session: ConversationSession;
      
      if (options.continue) {
        session = loadSession(options.continue) || createSession(model, options.system);
        if (!loadSession(options.continue)) {
          console.log(chalk.yellow(`Session ${options.continue} not found. Starting new session.`));
        }
      } else if (options.new) {
        session = createSession(model, options.system);
      } else {
        session = loadSession() || createSession(model, options.system);
        
        if (options.system) {
          const existingSystem = session.messages.find(m => m.role === 'system');
          if (existingSystem) {
            existingSystem.content = options.system;
          } else {
            session.messages.unshift({ role: 'system', content: options.system });
          }
        }
      }
      
      session.model = model;

      // ===== INTERACTIVE MODE (no prompt provided) =====
      if (!prompt) {
        await startInteractiveMode(router, session, config, options);
        return;
      }

      // ===== SINGLE MESSAGE MODE =====
      await sendMessage(router, session, prompt, config, options);
    });

  return cmd;
}

/**
 * Interactive multi-turn chat mode
 */
async function startInteractiveMode(
  router: Router,
  session: ConversationSession,
  config: any,
  options: any
): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.cyan('You > ')
  });

  // Show welcome banner
  console.log();
  console.log(chalk.cyan('┌─────────────────────────────────────────┐'));
  console.log(chalk.cyan('│') + chalk.white('  Octapus Interactive Chat                ') + chalk.cyan('│'));
  console.log(chalk.cyan('│') + chalk.gray(`  Model: ${session.model}`.padEnd(39)) + chalk.cyan('│'));
  console.log(chalk.cyan('│') + chalk.gray(`  Session: ${session.id}`.padEnd(39)) + chalk.cyan('│'));
  console.log(chalk.cyan('└─────────────────────────────────────────┘'));
  console.log();
  console.log(chalk.gray('  Type your message and press Enter.'));
  console.log(chalk.gray('  Commands: /quit, /history, /clear, /new, /model <name>, /help'));
  console.log();
  
  const askQuestion = (): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(chalk.cyan('You > '), (answer) => {
        resolve(answer.trim());
      });
    });
  };

  let running = true;

  while (running) {
    const input = await askQuestion();

    if (!input) continue;

    // Handle slash commands
    if (input.startsWith('/')) {
      const cmd = input.split(' ')[0].toLowerCase();
      const args = input.slice(cmd.length).trim();

      switch (cmd) {
        case '/quit':
        case '/exit':
        case '/q':
          running = false;
          console.log(chalk.gray('\nSession saved. Goodbye!'));
          break;

        case '/history':
          console.log();
          console.log(getHistoryText(session, 15));
          console.log();
          break;

        case '/clear':
          clearAllHistory();
          session = createSession(session.model);
          console.log(chalk.green('✓ History cleared, new session started.'));
          break;

        case '/new':
          session = createSession(session.model);
          console.log(chalk.green('✓ New session started.'));
          break;

        case '/model':
          if (args) {
            session.model = args;
            console.log(chalk.green(`✓ Model changed to: ${args}`));
          } else {
            console.log(chalk.gray(`Current model: ${session.model}`));
            console.log(chalk.gray('Usage: /model <model-name>'));
          }
          break;

        case '/help':
          console.log();
          console.log(chalk.white('Commands:'));
          console.log(chalk.gray('  /quit, /exit, /q   Exit interactive mode'));
          console.log(chalk.gray('  /history           Show conversation history'));
          console.log(chalk.gray('  /clear             Clear history & start new session'));
          console.log(chalk.gray('  /new               Start new session (keep history)'));
          console.log(chalk.gray('  /model [name]      Show or change model'));
          console.log(chalk.gray('  /help              Show this help'));
          console.log();
          break;

        default:
          console.log(chalk.yellow(`Unknown command: ${cmd}. Type /help for commands.`));
      }

      if (running) rl.prompt();
      continue;
    }

    // Send message to AI
    await sendMessage(router, session, input, config, options);
    rl.prompt();
  }

  rl.close();
}

/**
 * Send a single message and stream the response
 */
async function sendMessage(
  router: Router,
  session: ConversationSession,
  prompt: string,
  config: any,
  options: any
): Promise<void> {
  const model = session.model;
  const spinner = createSpinner({ text: `Thinking...` });
  
  const messages = getMessagesForApi(session, prompt);

  const startTime = Date.now();
  let fullResponse = '';

  try {
    spinner.start();
    
    const fallbackModels = options.fallback ? config.fallbackModels : [];
    let spinnerStopped = false;
    
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
      if (!spinnerStopped) {
        spinner.stop();
        spinnerStopped = true;
      }
      process.stdout.write(chalk.green(chunk));
      fullResponse += chunk;
    }
    
    console.log();
    
    // Save to history
    addMessage(session, 'user', prompt);
    addMessage(session, 'assistant', fullResponse);
    
    const duration = Date.now() - startTime;
    const inputTokens = estimateTokens(messages.map(m => m.content).join(' '));
    const outputTokens = estimateTokens(fullResponse);
    
    // Compact stats line
    if (config.settings.showTokens || config.settings.showCost) {
      const stats: string[] = [];
      if (config.settings.showTokens) {
        stats.push(`${formatUsage({ input: Math.round(inputTokens), output: Math.round(outputTokens), total: Math.round(inputTokens + outputTokens) })}`);
      }
      stats.push(`Time: ${formatDuration(duration)}`);
      if (config.settings.showCost) {
        const cost = estimateCost(model, Math.round(inputTokens), Math.round(outputTokens));
        stats.push(`Cost: ${formatCost(cost)}`);
      }
      console.log(chalk.gray(`  ${stats.join(' │ ')}`));
      console.log();
    }
    
  } catch (err) {
    spinner.fail(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
    console.log();
  }
}

/**
 * Estimate cost based on model and token usage
 */
function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const rates: Record<string, { input: number; output: number }> = {
    'groq': { input: 0, output: 0 },
    'cerebras': { input: 0, output: 0 },
    'gemini': { input: 0, output: 0 },
    'sambanova': { input: 0, output: 0 },
    'ollama': { input: 0, output: 0 },
    'together': { input: 0.0001, output: 0.0003 },
    'openrouter': { input: 0.00015, output: 0.0006 },
    'novita': { input: 0.0001, output: 0.0003 },
    'requesty': { input: 0.00015, output: 0.0006 }
  };
  
  let provider = 'unknown';
  if (model.includes('llama') && !model.includes('openrouter')) provider = 'groq';
  else if (model.includes('gemini')) provider = 'gemini';
  else if (model.includes('mixtral')) provider = 'groq';
  else if (model.includes('gemma')) provider = 'groq';
  else provider = 'together';
  
  const rate = rates[provider] || { input: 0, output: 0 };
  return (inputTokens * rate.input + outputTokens * rate.output) / 1000;
}
