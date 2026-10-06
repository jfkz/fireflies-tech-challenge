import { createApiClient } from './api';
import { env } from './env';

/**
 * The real API clients. Imported lazily (see lazyApi in AuthProvider) so the
 * schemas and zod are only downloaded once a page actually calls the API.
 */
export const publicClient = createApiClient({ baseUrl: env.apiUrl, getToken: async () => null });

export function authedClient(getToken: () => Promise<string | null>) {
  return createApiClient({ baseUrl: env.apiUrl, getToken });
}
