import { emulatorEnabled, parseEnv } from './env';
import { BASE_ENV, testConfig } from '../testing/fixtures';

describe('env', () => {
  it('applies defaults and splits lists', () => {
    const env = parseEnv({ ...BASE_ENV, WEB_ORIGINS: 'https://a.test, https://b.test', EMAIL_ALLOWLIST: '' });
    expect(env.WEB_ORIGINS).toEqual(['https://a.test', 'https://b.test']);
    expect(env.EMAIL_ALLOWLIST).toEqual([]);
    expect(env.SUMMARY_MODEL).toBe('anthropic/claude-haiku-4.5');
    expect(env.SUMMARIZE_CONCURRENCY).toBe(4);
    expect(env.AI_FAKE).toBe(false);
  });

  it('lists every problem at once', () => {
    expect(() => parseEnv({ NODE_ENV: 'test' })).toThrow(/DATABASE_URL[\s\S]*R2_BUCKET/);
  });

  it('refuses AI_FAKE outside tests', () => {
    expect(() => parseEnv({ ...BASE_ENV, NODE_ENV: 'production', AI_FAKE: '1' })).toThrow(/AI_FAKE/);
    expect(parseEnv({ ...BASE_ENV, AI_FAKE: '1' }).AI_FAKE).toBe(true);
  });

  it('never honours the auth emulator in production', () => {
    expect(emulatorEnabled({ NODE_ENV: 'production', FIREBASE_AUTH_EMULATOR_HOST: 'x' })).toBe(false);
    expect(emulatorEnabled({ NODE_ENV: 'development', FIREBASE_AUTH_EMULATOR_HOST: 'x' })).toBe(true);
    expect(testConfig({ NODE_ENV: 'production' }).isProduction).toBe(true);
  });
});
