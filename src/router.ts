import { Provider, Message, ChatOptions, RouterOptions } from './providers';
import { loadConfig } from './config';
import chalk from 'chalk';

export interface ChatResult {
  provider: string;
  model: string;
  stream: AsyncIterable<string>;
}

export class Router {
  private providers: Map<string, Provider> = new Map();
  private modelToProvider: Map<string, string> = new Map();
  private config = loadConfig();
  
  // Track last used provider/model for stats
  public lastProvider: string = '';
  public lastModel: string = '';

  register(provider: Provider): void {
    this.providers.set(provider.name, provider);
    for (const model of provider.models) {
      if (!this.modelToProvider.has(model)) {
        this.modelToProvider.set(model, provider.name);
      }
    }
  }

  getProvider(name: string): Provider | undefined {
    return this.providers.get(name);
  }

  getProviderForModel(model: string): Provider | undefined {
    const providerName = this.modelToProvider.get(model);
    if (providerName) return this.providers.get(providerName);
    
    // Try to find provider that has this model in its list
    for (const [name, provider] of this.providers) {
      if (provider.models.includes(model)) {
        this.modelToProvider.set(model, name);
        return provider;
      }
    }
    return undefined;
  }

  getFallbackChain(model: string): Array<{ provider: Provider; modelToUse: string }> {
    const chain: Array<{ provider: Provider; modelToUse: string }> = [];
    const primary = this.getProviderForModel(model);
    if (primary) {
      const modelToUse = primary.models.includes(model) ? model : primary.models[0];
      chain.push({ provider: primary, modelToUse });
    }

    // Add fallback models from config
    for (const fallbackModel of this.config.fallbackModels) {
      if (fallbackModel === model) continue;
      const provider = this.getProviderForModel(fallbackModel);
      if (provider && !chain.some(c => c.provider === provider)) {
        const modelToUse = provider.models.includes(fallbackModel) ? fallbackModel : provider.models[0];
        chain.push({ provider, modelToUse });
      }
    }

    // Add any other enabled providers (skip if not enabled)
    for (const provider of this.providers.values()) {
      if (!chain.some(c => c.provider === provider)) {
        const cfg = this.config.providers[provider.name];
        if (cfg?.enabled && provider.models.length > 0) {
          chain.push({ provider, modelToUse: provider.models[0] });
        }
      }
    }

    return chain;
  }

  async *chat(options: RouterOptions): AsyncIterable<string> {
    const { model, messages, options: chatOptions, fallbackModels } = options;
    const chain = this.getFallbackChain(model);
    
    if (chain.length === 0) {
      throw new Error(`No provider available for model: ${model}`);
    }

    let lastError: Error | null = null;
    let isFirstChunk = true;

    for (const { provider, modelToUse } of chain) {
      try {
        // Track which provider/model we're using
        this.lastProvider = provider.name;
        this.lastModel = modelToUse;
        
        // Notify user if we're using a different model
        if (modelToUse !== model && isFirstChunk) {
          console.error(chalk.gray(`  (Using ${modelToUse} from ${provider.name} as fallback)`));
        }
        
        yield* provider.chat(messages, {
          ...chatOptions,
          model: modelToUse
        });
        return; // Success
      } catch (err) {
        lastError = err as Error;
        // Use styled error output instead of console.error
        console.log(chalk.gray(`  [${provider.name}] ${err instanceof Error ? err.message : String(err)}`));
        continue;
      }
    }

    throw lastError || new Error('All providers failed');
  }

  async validateAllKeys(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};
    for (const [name, provider] of this.providers) {
      results[name] = await provider.validateKey();
    }
    return results;
  }

  getAvailableModels(): string[] {
    const models = new Set<string>();
    for (const provider of this.providers.values()) {
      for (const model of provider.models) {
        models.add(model);
      }
    }
    return Array.from(models).sort();
  }

  getProviderStatus(): Record<string, { models: string[]; priority: number; enabled: boolean }> {
    const status: Record<string, { models: string[]; priority: number; enabled: boolean }> = {};
    for (const [name, provider] of this.providers) {
      const cfg = this.config.providers[name];
      status[name] = {
        models: provider.models,
        priority: provider.priority,
        enabled: cfg?.enabled ?? false
      };
    }
    return status;
  }
}
