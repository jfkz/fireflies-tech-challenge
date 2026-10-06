import { test as base, expect } from '@playwright/test';
import { mockApi, type MockApi } from './mockApi';

/** `api` installs the mocked BoringTalks API before the test body runs. */
export const test = base.extend<{ api: MockApi }>({
  api: async ({ page }, use) => {
    await use(await mockApi(page));
  },
});

export { expect };
