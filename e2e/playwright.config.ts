import { defineConfig, devices } from '@playwright/test';

/**
 * Two projects:
 *  - ui:    the web app against the Firebase Auth emulator, with the API mocked by page.route.
 *  - smoke: public pages of a deployed environment (BASE_URL, API_URL), nothing mocked.
 */
const smokeOnly = process.argv.some((a) => a === '--project=smoke' || a === 'smoke');
// `playwright test` without --project would also run the screenshot project; default to ui.
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3210);
export const MOCK_API_URL = 'http://localhost:4999';
const prodServer = process.env.E2E_PROD === '1';

const webEnv = {
  NEXT_PUBLIC_API_URL: MOCK_API_URL,
  NEXT_PUBLIC_SITE_URL: `http://localhost:${WEB_PORT}`,
  NEXT_PUBLIC_FIREBASE_API_KEY: 'demo-key',
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'localhost',
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'demo-boringtalks',
  NEXT_PUBLIC_FIREBASE_APP_ID: 'demo-app',
  NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR: 'http://127.0.0.1:9099',
  NEXT_TELEMETRY_DISABLED: '1',
};

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      // Compiles every route once so `next dev` latency doesn't eat into test timeouts.
      name: 'warmup',
      testDir: './tests',
      testMatch: /warmup\.setup\.ts/,
      use: { baseURL: `http://localhost:${WEB_PORT}` },
    },
    {
      name: 'ui',
      testDir: './tests/ui',
      dependencies: ['warmup'],
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${WEB_PORT}` },
    },
    {
      // Not a test: captures desktop and phone screenshots for visual review (`pnpm screenshots`).
      name: 'shots',
      testDir: './tests/shots',
      dependencies: ['warmup'],
      timeout: 180_000,
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${WEB_PORT}` },
    },
    {
      name: 'smoke',
      testDir: './tests/smoke',
      use: { ...devices['Desktop Chrome'], baseURL: process.env.BASE_URL ?? 'https://dev.boringtalks.lol' },
    },
  ],
  webServer: smokeOnly
    ? undefined
    : [
        {
          command: 'pnpm exec firebase emulators:start --only auth --project demo-boringtalks',
          url: 'http://127.0.0.1:9099',
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          stdout: 'ignore',
        },
        {
          command: prodServer
            ? `pnpm --filter @boringtalks/web build && pnpm --filter @boringtalks/web exec next start -p ${WEB_PORT}`
            : `pnpm --filter @boringtalks/web exec next dev -p ${WEB_PORT}`,
          url: `http://localhost:${WEB_PORT}`,
          env: webEnv,
          reuseExistingServer: !process.env.CI,
          timeout: 240_000,
        },
      ],
});
