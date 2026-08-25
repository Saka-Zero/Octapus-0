import { loadConfig, saveConfig, resetConfig, getConfigPath } from '../src/config';
import * as fs from 'fs';
import * as path from 'path';

describe('Config', () => {
  const testConfigDir = path.join(__dirname, 'test-config');
  const testConfigFile = path.join(testConfigDir, 'config.yaml');

  beforeAll(() => {
    if (!fs.existsSync(testConfigDir)) {
      fs.mkdirSync(testConfigDir, { recursive: true });
    }
  });

  afterAll(() => {
    if (fs.existsSync(testConfigDir)) {
      fs.rmSync(testConfigDir, { recursive: true });
    }
  });

  beforeEach(() => {
    if (fs.existsSync(testConfigFile)) {
      fs.unlinkSync(testConfigFile);
    }
  });

  test('loadConfig returns defaults when no file', () => {
    const config = loadConfig();
    expect(config).toBeDefined();
    expect(config.providers).toBeDefined();
    expect(config.defaultModel).toBeDefined();
  });

  test('saveConfig creates file', () => {
    const config = loadConfig();
    config.providers.groq.apiKey = 'test-key';
    config.providers.groq.enabled = true;
    saveConfig(config);
    expect(fs.existsSync(getConfigPath())).toBe(true);
  });

  test('resetConfig restores defaults', () => {
    const config = loadConfig();
    config.providers.groq.apiKey = 'test-key';
    saveConfig(config);
    resetConfig();
    const reset = loadConfig();
    expect(reset.providers.groq.apiKey).toBe('');
  });
});

describe('Router', () => {
  // Router tests would go here
  test('placeholder', () => {
    expect(true).toBe(true);
  });
});