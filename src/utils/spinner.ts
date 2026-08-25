import ora from 'ora';
import chalk from 'chalk';

export interface SpinnerOptions {
  text?: string;
  color?: 'yellow' | 'green' | 'blue' | 'red' | 'cyan' | 'magenta';
}

export function createSpinner(options: SpinnerOptions = {}) {
  const spinner = ora({
    text: options.text || 'Thinking...',
    color: options.color || 'cyan',
    spinner: 'dots'
  });
  return spinner;
}

export function formatTokens(input: number, output: number): string {
  return `Tokens: ${input.toLocaleString()} in / ${output.toLocaleString()} out`;
}

export function estimateCost(provider: string, inputTokens: number, outputTokens: number): number {
  const rates: Record<string, { input: number; output: number }> = {
    groq: { input: 0, output: 0 }, // Free tier
    gemini: { input: 0, output: 0 }, // Free tier
    ollama: { input: 0, output: 0 }, // Local
    openrouter: { input: 0.0001, output: 0.0003 }, // Varies by model
    requesty: { input: 0.0001, output: 0.0003 }
  };
  
  const rate = rates[provider] || { input: 0, output: 0 };
  return (inputTokens * rate.input + outputTokens * rate.output) / 1000;
}

export function formatCost(cost: number): string {
  if (cost === 0) return chalk.green('Free');
  if (cost < 0.01) return chalk.yellow(`$${cost.toFixed(4)}`);
  return chalk.red(`$${cost.toFixed(2)}`);
}

export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}