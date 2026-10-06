import { expect, test } from '@playwright/test';
import { LatestDownload } from '@boringtalks/shared';

/** Read-only checks of a deployed environment: BASE_URL (web) and API_URL (api). */
const API_URL = (process.env.API_URL ?? 'https://api.dev.boringtalks.lol').replace(/\/+$/, '');

test('landing loads without console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Your meeting, minus the meeting.');
  await page.locator('#download').scrollIntoViewIfNeeded();
  await page.waitForLoadState('networkidle');
  expect(errors).toEqual([]);
});

test('sign-in page renders', async ({ page }) => {
  await page.goto('/signin');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
});

test('API health is ok', async ({ request }) => {
  const res = await request.get(`${API_URL}/health`);
  expect(res.ok()).toBe(true);
});

test('latest download is a DMG or not published yet', async ({ request }) => {
  const res = await request.get(`${API_URL}/downloads/latest`);
  expect([200, 404]).toContain(res.status());
  if (res.status() === 200) {
    const latest = LatestDownload.parse(await res.json());
    expect(latest.url).toMatch(/\.dmg$/);
  }
});
