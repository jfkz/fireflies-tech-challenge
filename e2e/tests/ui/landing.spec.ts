import { expect, test } from '@playwright/test';
import { latestDownload } from '../../fixtures/data';
import { mockApi } from '../../fixtures/mockApi';

test.describe('landing', () => {
  test('renders the story and the download button points at the DMG from /downloads/latest', async ({ page }) => {
    const latest = latestDownload({ url: 'https://download.boringtalks.lol/BoringTalks-9.9.9.dmg', version: '9.9.9' });
    await mockApi(page, { latest });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Your meeting, minus the meeting.' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'How it works' })).toBeAttached();

    await page.getByRole('link', { name: 'Download for Mac' }).first().click();
    const dmg = page.getByTestId('download-dmg');
    await expect(dmg).toHaveAttribute('href', latest.url);
    await expect(page.getByText('Version 9.9.9 (42)')).toBeVisible();
    await expect(page.getByText('macOS 26 or later')).toBeVisible();
    await expect(page.getByText('Apple silicon & Intel')).toBeVisible();
  });

  test('shows the right-click → Open step for a build that is not notarized', async ({ page }) => {
    await mockApi(page, { latest: latestDownload({ notarized: false }) });
    await page.goto('/#download');
    await expect(page.getByTestId('download-dmg')).toBeVisible();
    await expect(page.getByText('right-click the app and choose Open')).toBeVisible();
  });

  test('shows “coming soon” while there is no build (404)', async ({ page }) => {
    await mockApi(page, { latest: null });
    await page.goto('/#download');
    await expect(page.getByTestId('download-coming-soon')).toBeVisible();
    await expect(page.getByTestId('download-dmg')).toHaveCount(0);
  });

  test('reduced motion: static, readable, no horizontal scroll at 375 px', async ({ page }) => {
    await mockApi(page, { latest: latestDownload() });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 375, height: 760 });
    await page.goto('/');
    // The scroll story collapses to plain blocks, and its text is all on the page.
    await expect(page.getByRole('heading', { name: 'Meetings are boring.' }).last()).toBeVisible();
    await expect(page.getByText('Minute 47. The fourth status meeting this week.').last()).toBeVisible();
    const trackHeight = await page.locator('.scrolly').first().evaluate((el) => el.getBoundingClientRect().height);
    expect(trackHeight).toBeLessThan(760 * 1.5);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const shot = await page.screenshot({ fullPage: true });
    expect(shot.byteLength).toBeGreaterThan(20_000);
  });
});
