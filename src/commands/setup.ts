import chalk from 'chalk';
import * as readline from 'readline';
import { loadConfig, saveConfig } from '../config';
import { Router } from '../router';

/**
 * Interactive setup wizard: pick a provider, paste its API key,
 * auto-enable + test. Repeat until done.
 */
export async function runSetup(router: Router): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> =>
    new Promise((resolve) => rl.question(q, (a) => resolve(a.trim())));

  const PROVIDERS: Array<{ name: string; keyUrl: string; note?: string }> = [
    { name: 'opencode-zen', keyUrl: 'https://opencode.ai/zen', note: 'FREE models — login once via `opencode auth login`, auto-imported!' },
    { name: 'gemini', keyUrl: 'https://aistudio.google.com/apikey' },
    { name: 'groq', keyUrl: 'https://console.groq.com/keys' },
    { name: 'github-models', keyUrl: 'https://github.com/settings/tokens', note: 'PAT with models scope' },
    { name: 'openrouter', keyUrl: 'https://openrouter.ai/keys' },
    { name: 'mistral', keyUrl: 'https://console.mistral.ai/api-keys' },
    { name: 'cerebras', keyUrl: 'https://cloud.cerebras.ai' },
    { name: 'sambanova', keyUrl: 'https://cloud.sambanova.ai' },
    { name: 'nvidia', keyUrl: 'https://build.nvidia.com' },
    { name: 'cohere', keyUrl: 'https://dashboard.cohere.com/api-keys' },
    { name: 'huggingface', keyUrl: 'https://huggingface.co/settings/tokens' },
    { name: 'together', keyUrl: 'https://api.together.xyz' },
    { name: 'zhipu', keyUrl: 'https://open.bigmodel.cn', note: 'glm-4-flash free forever' },
    { name: 'hunyuan', keyUrl: 'https://console.cloud.tencent.com/hunyuan/api-key', note: 'hunyuan-lite free forever' },
    { name: 'qianfan', keyUrl: 'https://console.bce.baidu.com/iam/', note: 'ernie-speed free' },
    { name: 'siliconflow', keyUrl: 'https://siliconflow.cn' },
    { name: 'modelscope', keyUrl: 'https://modelscope.cn' },
    { name: 'chutes', keyUrl: 'https://chutes.ai/app/api-keys' },
    { name: 'venice', keyUrl: 'https://venice.ai/settings/api-keys' },
    { name: 'scaleway', keyUrl: 'https://console.scaleway.com' },
    { name: 'novita', keyUrl: 'https://novita.ai' },
    { name: 'requesty', keyUrl: 'https://requesty.ai' }
  ];

  console.log();
  console.log(chalk.cyan.bold('🐙 Octapus Setup Wizard'));
  console.log(chalk.gray('Configure providers one by one. Ctrl+C to exit anytime.'));
  console.log();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const config = loadConfig();

    // Show current status table
    console.log(chalk.white('Provider status:'));
    const noKeyNeeded = ['pollinations', 'ollama', 'lmstudio'];
    const all = [
      ...PROVIDERS.map((p, i) => ({ ...p, idx: i + 1 })),
      ...noKeyNeeded.map((n, i) => ({ name: n, keyUrl: '', note: 'no key needed', idx: PROVIDERS.length + i + 1 }))
    ];
    for (const p of all) {
      const cfg = config.providers[p.name];
      const state = cfg?.enabled
        ? cfg.apiKey || noKeyNeeded.includes(p.name)
          ? chalk.green('● on ')
          : chalk.yellow('◐ on·nokey')
        : chalk.red('○ off');
      console.log(`  ${state}  ${chalk.white(String(p.idx).padStart(2))}. ${p.name.padEnd(16)} ${chalk.gray(p.note || '')}`);
    }
    console.log(chalk.gray('   q. Done'));
    console.log();

    const answer = (await ask(chalk.cyan('Number to configure (or q): '))).toLowerCase();
    if (answer === 'q' || answer === '') break;

    const picked = all.find((p) => String(p.idx) === answer);
    if (!picked) {
      console.log(chalk.red('Invalid choice.\n'));
      continue;
    }

    if (noKeyNeeded.includes(picked.name)) {
      config.providers[picked.name].enabled = true;
      saveConfig(config);
      console.log(chalk.green(`✓ ${picked.name} enabled — no key needed.\n`));
      continue;
    }

    console.log(chalk.gray(`Get your key: ${picked.keyUrl}`));
    const key = await ask(chalk.cyan(`Paste ${picked.name} API key: `));
    if (!key) {
      console.log(chalk.yellow('Skipped (empty key).\n'));
      continue;
    }

    config.providers[picked.name].apiKey = key;
    config.providers[picked.name].enabled = true;
    saveConfig(config);
    console.log(chalk.green(`✓ Saved & enabled ${picked.name}. Testing…`));

    // Fresh router registration for immediate test
    const testRouter = new Router();
    const { OpenAICompatibleProvider } = await import('../providers/openai-compatible');
    const defaults = getDefaultModels(picked.name);
    testRouter.register(new OpenAICompatibleProvider(picked.name, key, config.providers[picked.name].baseURL || defaultBaseURL(picked.name), 5, defaults));
    try {
      const ok = await testRouter.getProvider(picked.name)!.validateKey();
      console.log(ok ? chalk.green(`✓ ${picked.name}: Connected!\n`) : chalk.yellow(`⚠ ${picked.name}: saved, but validation failed — double-check the key.\n`));
    } catch {
      console.log(chalk.yellow(`⚠ ${picked.name}: saved, but couldn't reach the API right now.\n`));
    }
  }

  rl.close();
  console.log(chalk.green('\n✓ Setup complete. Start chatting: oct chat\n'));
}

function defaultBaseURL(name: string): string {
  const map: Record<string, string> = {
    'github-models': 'https://models.inference.ai.azure.com',
    mistral: 'https://api.mistral.ai/v1',
    nvidia: 'https://integrate.api.nvidia.com/v1',
    cohere: 'https://api.cohere.ai/compatibility/v1',
    huggingface: 'https://router.huggingface.co/v1',
    zhipu: 'https://open.bigmodel.cn/api/paas/v4',
    siliconflow: 'https://api.siliconflow.cn/v1',
    modelscope: 'https://api-inference.modelscope.cn/v1',
    chutes: 'https://api.chutes.ai/app/api/v1',
    venice: 'https://api.venice.ai/api/v1',
    scaleway: 'https://api.scaleway.ai/v1'
  };
  return map[name] || '';
}

function getDefaultModels(name: string): string[] {
  const map: Record<string, string[]> = {
    'github-models': ['gpt-4o', 'gpt-4o-mini', 'o3-mini'],
    mistral: ['mistral-large-latest', 'mistral-small-latest', 'codestral-latest'],
    nvidia: ['meta/llama-3.3-70b-instruct'],
    cohere: ['command-r-plus-08-2024'],
    huggingface: ['Qwen/Qwen2.5-72B-Instruct'],
    zhipu: ['glm-4-flash'],
    siliconflow: ['Qwen/Qwen2.5-7B-Instruct'],
    modelscope: ['Qwen/Qwen2.5-72B-Instruct'],
    chutes: ['deepseek-ai/DeepSeek-R1'],
    venice: ['llama-3.3-70b'],
    scaleway: ['qwen2.5-72b-instruct']
  };
  return map[name] || [];
}
