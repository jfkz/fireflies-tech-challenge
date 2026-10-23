import { afterEach, describe, expect, it, vi } from 'vitest';

describe('env', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('defaults to the local API and strips trailing slashes', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.dev.boringtalks.lol///');
    vi.stubEnv('NEXT_PUBLIC_FIREBASE_API_KEY', '  ');
    const { env } = await import('./env');
    expect(env.apiUrl).toBe('https://api.dev.boringtalks.lol');
    expect(env.firebase.apiKey).toBeUndefined();
  });

  it('turns analytics on only with a PostHog key', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', ' ');
    expect((await import('./env')).env.posthog).toEqual({ key: undefined, uiHost: 'https://us.posthog.com' });
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test');
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_UI_HOST', 'https://us.posthog.com/');
    expect((await import('./env')).env.posthog).toEqual({ key: 'phc_test', uiHost: 'https://us.posthog.com' });
  });

  it('rejects an API URL that is not a URL', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'not a url');
    await expect(import('./env')).rejects.toThrow(/NEXT_PUBLIC_API_URL must be an absolute URL/);
  });
});
