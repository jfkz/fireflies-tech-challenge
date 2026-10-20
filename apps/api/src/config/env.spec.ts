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
    expect(env.ADMIN_EMAILS).toEqual([]);
  });

  it('knows owners by email in any case, and admins by owner or flag', () => {
    const config = testConfig({ ADMIN_EMAILS: 'Boss@Example.com, ops@example.com' });
    expect(config.env.ADMIN_EMAILS).toEqual(['boss@example.com', 'ops@example.com']);
    expect(config.isOwner('BOSS@example.com')).toBe(true);
    expect(config.isOwner('ann@example.com')).toBe(false);
    expect(config.isOwner(null)).toBe(false);
    expect(testConfig().isOwner('boss@example.com')).toBe(false);
    expect(config.isAdmin({ email: 'boss@example.com', isAdmin: false })).toBe(true);
    expect(config.isAdmin({ email: 'ann@example.com', isAdmin: true })).toBe(true);
    expect(config.isAdmin({ email: 'ann@example.com', isAdmin: false })).toBe(false);
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
