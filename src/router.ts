import { Provider, Message, ChatOptions, RouterOptions } from './providers';
import { loadConfig } from './config';

export class Router {
  private providers: Map<string, Provider> = new Map();
  private modelToProvider: Map<string, string> = new Map();
  private config = loadConfig();

  register(provider: Provider): void {
    this.providers.set(provider.name, provider);
    for (const model of provider.models) {
      if (!this.modelToProvider.has(model)) {
        this.modelToProvider.set(model, provider.name);
      }
    }
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

  getFallbackChain(model: string): Provider[] {
    const chain: Provider[] = [];
    const primary = this.getProviderForModel(model);
    if (primary) chain.push(primary);

    // Add fallback models from config
    for (const fallbackModel of this.config.fallbackModels) {
      if (fallbackModel === model) continue;
      const provider = this.getProviderForModel(fallbackModel);
      if (provider && !chain.includes(provider)) {
        chain.push(provider);
      }
    }

    // Add any other enabled providers (skip if not enabled)
    for (const provider of this.providers.values()) {
      if (!chain.includes(provider)) {
        const cfg = this.config.providers[provider.name];
        if (cfg?.enabled) {
          chain.push(provider);
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

    for (const provider of chain) {
      try {
        // Check if provider supports the model
        const modelToUse = provider.models.includes(model) ? model : provider.models[0];
        
        yield* provider.chat(messages, {
          ...chatOptions,
          model: modelToUse
        });
        return; // Success
      } catch (err) {
        lastError = err as Error;
        console.error(`[${provider.name}] failed: ${err instanceof Error ? err.message : String(err)}`);
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