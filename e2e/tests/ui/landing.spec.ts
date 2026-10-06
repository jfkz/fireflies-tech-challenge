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

  for (const [width, height] of [
    [1280, 720],
    [1440, 900],
    [1024, 768],
    [390, 844],
  ]) {
    test(`hero buttons never cover a face at ${width}×${height}`, async ({ page }) => {
      await mockApi(page, { latest: latestDownload() });
      await page.setViewportSize({ width, height });
      await page.goto('/');
      const hero = page.locator('section[aria-labelledby="hero-title"]');
      const buttons = [hero.getByRole('link', { name: 'Download for Mac' }), hero.getByRole('link', { name: 'or try it in the browser →' })];
      await expect(hero.locator('[data-talking]')).toHaveCount(4);
      // Let the heads finish sliding up into their seats.
      await page.waitForTimeout(1500);
      const heads = await hero.locator('[data-talking]').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON() as DOMRect));
      for (const button of buttons) {
        const b = (await button.boundingBox())!;
        for (const h of heads) {
          // Faces are the middle of each head's box (the box itself includes some air around the hair).
          const face = { left: h.x + h.width * 0.2, right: h.x + h.width * 0.8, top: h.y + h.height * 0.25, bottom: h.y + h.height };
          const overlaps = b.x < face.right && b.x + b.width > face.left && b.y < face.bottom && b.y + b.height > face.top;
          expect(overlaps, `${await button.textContent()} overlaps a head`).toBe(false);
        }
      }
    });
  }

  test('the heads talk out loud only after the visitor turns sound on, and the choice sticks', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { oscillators: number };
      w.oscillators = 0;
      const create = AudioContext.prototype.createOscillator;
      AudioContext.prototype.createOscillator = function () {
        w.oscillators++;
        return create.call(this);
      };
    });
    await mockApi(page, { latest: latestDownload() });
    await page.goto('/');
    const toggle = page.getByTestId('sound-toggle');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await page.waitForTimeout(3500);
    expect(await page.evaluate(() => (window as unknown as { oscillators: number }).oscillators)).toBe(0);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => page.evaluate(() => (window as unknown as { oscillators: number }).oscillators), { timeout: 8000 }).toBeGreaterThan(0);

    await toggle.click();
    await expect(toggle).toHaveText('Sound off');
    expect(await page.evaluate(() => localStorage.getItem('bt.sound'))).toBe('off');
  });

  test('answers the common questions and tells search engines about them', async ({ page }) => {
    await mockApi(page, { latest: latestDownload() });
    await page.goto('/#faq');
    const question = page.getByText('Does a bot join my call?');
    await question.click();
    await expect(page.getByText('Nobody gets a “Notetaker has joined” message.', { exact: false })).toBeVisible();
    const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent())!);
    const types = ld['@graph'].map((n: { '@type': string }) => n['@type']);
    expect(types).toEqual(expect.arrayContaining(['SoftwareApplication', 'FAQPage', 'Organization']));
    // No cost or technical talk on the page any more.
    await expect(page.getByText(/\$0\.0|AI call|speech model/)).toHaveCount(0);
  });
});

