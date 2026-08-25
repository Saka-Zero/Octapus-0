import { Provider, Message, ChatOptions, RouterOptions, StreamEvent } from './providers';
import { loadConfig } from './config';
import chalk from 'chalk';

export interface ChatResult {
  provider: string;
  model: string;
  stream: AsyncIterable<StreamEvent>;
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

  getFallbackChain(model: string, fallbackModels?: string[], disableFallback = false, domain?: string): Array<{ provider: Provider; modelToUse: string }> {
    const chain: Array<{ provider: Provider; modelToUse: string }> = [];
    const primary = this.getProviderForModel(model);
    if (primary) {
      const modelToUse = primary.models.includes(model) ? model : primary.models[0];
      chain.push({ provider: primary, modelToUse });
    }

    // If fallback is disabled, only use the primary provider
    if (disableFallback) {
      return chain;
    }

    // Add fallback models from config (or override if provided)
    const models = fallbackModels ?? this.config.fallbackModels;
    for (const fallbackModel of models) {
      if (fallbackModel === model) continue;
      const provider = this.getProviderForModel(fallbackModel);
      if (provider && !chain.some(c => c.provider === provider)) {
        const modelToUse = provider.models.includes(fallbackModel) ? fallbackModel : provider.models[0];
        chain.push({ provider, modelToUse });
      }
    }

    // Remaining enabled providers: role-matched first (domain routing), then priority
    const roleMatches = (p: Provider): number => {
      if (!domain) return 0;
      const role = this.config.providers[p.name]?.role;
      if (!role) return 0;
      if (domain === 'coding' && role === 'coder') return 1;
      if (domain === 'security' && role === 'security') return 1;
      if (domain === 'general' && role === 'general') return 1;
      return 0;
    };

    const remaining = Array.from(this.providers.values())
      .filter(provider => !chain.some(c => c.provider === provider))
      .filter(provider => {
        const cfg = this.config.providers[provider.name];
        return cfg?.enabled && provider.models.length > 0;
      })
      .sort((a, b) => {
        const ra = roleMatches(a), rb = roleMatches(b);
        if (ra !== rb) return rb - ra;           // specialists first
        return b.priority - a.priority;          // then priority
      });

    for (const provider of remaining) {
      chain.push({ provider, modelToUse: provider.models[0] });
    }

    return chain;
  }

  async *chat(options: RouterOptions): AsyncIterable<StreamEvent> {
    const { model, messages, options: chatOptions, fallbackModels, domain } = options;
    const quiet = chatOptions?.quiet ?? false;
    const chain = this.getFallbackChain(model, fallbackModels, chatOptions?.disableFallback ?? false, domain);

    if (chain.length === 0) {
      throw new Error(`No provider available for model: ${model}`);
    }

    let lastError: Error | null = null;

    for (const { provider, modelToUse } of chain) {
      try {
        // Track which provider/model we're using
        this.lastProvider = provider.name;
        this.lastModel = modelToUse;

        // Notify user if we're using a different model (skip in TUI/quiet mode)
        if (!quiet && modelToUse !== model) {
          console.error(chalk.gray(`  (Using ${modelToUse} from ${provider.name} as fallback)`));
        }

        yield* provider.chat(messages, {
          ...chatOptions,
          model: modelToUse
        });
        return; // Success
      } catch (err) {
        lastError = err as Error;
        if (!quiet) {
          console.log(chalk.gray(`  [${provider.name}] ${err instanceof Error ? err.message : String(err)}`));
        }
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
