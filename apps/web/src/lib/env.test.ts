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

  it('rejects an API URL that is not a URL', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'not a url');
    await expect(import('./env')).rejects.toThrow(/NEXT_PUBLIC_API_URL must be an absolute URL/);
  });
});
