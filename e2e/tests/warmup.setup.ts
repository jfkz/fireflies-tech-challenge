import { test as setup } from '@playwright/test';

const ROUTES = ['/', '/signin', '/signup', '/reset', '/meetings', '/meetings/00000000-0000-4000-8000-000000000000', '/record', '/settings', '/connect', '/nope'];

// In a real browser, so lazily imported client chunks (Firebase, Motion) get compiled too.
setup('compile every route once', async ({ page }) => {
  setup.setTimeout(300_000);
  for (const route of ROUTES) {
    await page.goto(route, { timeout: 120_000 });
    await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
  }
});
