import type { ApiClient } from './api';

/**
 * An ApiClient whose module (and the zod schemas behind it) loads on the first
 * call. Every method returns a promise anyway, so callers can't tell.
 */
export function lazyApi(load: () => Promise<ApiClient>): ApiClient {
  let client: Promise<ApiClient> | null = null;
  return new Proxy({} as ApiClient, {
    get(_target, name: string) {
      return async (...args: unknown[]) => {
        client ??= load();
        const api = await client;
        return (api[name as keyof ApiClient] as (...a: unknown[]) => unknown)(...args);
      };
    },
  });
}
