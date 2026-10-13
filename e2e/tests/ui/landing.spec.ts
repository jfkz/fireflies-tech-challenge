import { expect, test } from '@playwright/test';
import { latestDownload, windowsDownload } from '../../fixtures/data';
import { mockApi } from '../../fixtures/mockApi';

const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const WIN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const LINUX_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

test.describe('landing on a Mac', () => {
  test.use({ userAgent: MAC_UA });

  test('renders the story and the download button points at the DMG from /downloads', async ({ page }) => {
    const latest = latestDownload({ url: 'https://download.boringtalks.lol/BoringTalks-9.9.9.dmg', version: '9.9.9' });
    await mockApi(page, { latest, windows: windowsDownload() });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Your meeting, minus the meeting.' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'How it works' })).toBeAttached();

    // The big button downloads the Mac app itself; the Windows app is a small link under it.
    const hero = page.locator('section[aria-labelledby="hero-title"]');
    await expect(hero.getByTestId('hero-download')).toHaveText('Download for Mac');
    await expect(hero.getByTestId('hero-download')).toHaveAttribute('href', latest.url);
    await expect(hero.getByRole('link', { name: 'Windows', exact: true })).toHaveAttribute('href', /\.exe$/);
    await hero.getByRole('link', { name: 'all downloads' }).click();
    const dmg = page.getByTestId('download-dmg');
    await expect(dmg).toHaveAttribute('href', latest.url);
    await expect(page.getByText('Version 9.9.9 (42)')).toBeVisible();
    await expect(page.getByText('macOS 26 or later')).toBeVisible();
    await expect(page.getByText('Apple silicon & Intel')).toBeVisible();
    // The Windows app is offered too, underneath.
    await expect(page.getByTestId('download-exe')).toHaveAttribute('href', /\.exe$/);
  });

  test('shows the right-click → Open step for a build that is not notarized', async ({ page }) => {
    await mockApi(page, { latest: latestDownload({ notarized: false }) });
    await page.goto('/#download');
    await expect(page.getByTestId('download-dmg')).toBeVisible();
    await expect(page.getByText('right-click the app and choose Open')).toBeVisible();
  });

  test('shows “coming soon” while there is no build', async ({ page }) => {
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

  // On Windows, so the widest label ("Download for Windows") is the one measured.
  for (const [width, height] of [
    [1280, 720],
    [1440, 900],
    [1024, 768],
    [390, 844],
  ]) {
    test(`hero buttons never cover a face at ${width}×${height}`, async ({ browser }) => {
      const context = await browser.newContext({ userAgent: WIN_UA });
      const page = await context.newPage();
      await mockApi(page, { latest: latestDownload(), windows: windowsDownload() });
      await page.setViewportSize({ width, height });
      await page.goto('/');
      const hero = page.locator('section[aria-labelledby="hero-title"]');
      const buttons = [
        hero.getByRole('link', { name: 'Download for Windows' }),
        hero.getByRole('link', { name: 'Mac', exact: true }),
        hero.getByRole('link', { name: 'all downloads' }),
        hero.getByRole('link', { name: 'or try it in the browser →' }),
      ];
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
      await context.close();
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

test.describe('landing on Windows', () => {
  test.use({ userAgent: WIN_UA });

  test('offers the Windows installer first, with the SmartScreen step, and the Mac app underneath', async ({ page }) => {
    const windows = windowsDownload({ url: 'https://download.boringtalks.lol/BoringTalks-Setup-9.9.9.exe', version: '9.9.9' });
    await mockApi(page, { latest: latestDownload(), windows });
    await page.goto('/');
    const hero = page.locator('section[aria-labelledby="hero-title"]');
    await expect(hero.getByTestId('hero-download')).toHaveText('Download for Windows');
    await expect(hero.getByTestId('hero-download')).toHaveAttribute('href', windows.url);
    await expect(hero.getByRole('link', { name: 'Mac', exact: true })).toHaveAttribute('href', /\.dmg$/);
    // Clicking the big button also brings up the first-launch steps.
    await page.route(windows.url, (route) => route.fulfill({ body: 'MZ', headers: { 'content-type': 'application/vnd.microsoft.portable-executable', 'content-disposition': 'attachment' } }));
    await hero.getByTestId('hero-download').click();
    await expect(page.getByRole('heading', { name: 'Put a notetaker on your PC.' })).toBeInViewport();
    await expect(page.getByTestId('first-launch-windows')).toContainText('Run BoringTalks-Setup-9.9.9.exe.');
    const card = page.getByTestId('download-card-windows');
    await expect(card.getByTestId('download-exe')).toHaveAttribute('href', windows.url);
    await expect(card.getByText('Version 9.9.9 (61)')).toBeVisible();
    await expect(card.getByText('Windows 10 or later')).toBeVisible();
    await expect(page.getByTestId('first-launch-windows')).toContainText('More info');
    await expect(page.getByTestId('first-launch-windows')).toContainText('Run anyway');
    await expect(page.getByText('Also for Mac:')).toBeVisible();
    await expect(page.getByTestId('download-dmg')).toHaveAttribute('href', /\.dmg$/);
  });

  test('still offers the Mac app before the Windows app ships', async ({ page }) => {
    await mockApi(page, { latest: latestDownload(), windows: null });
    await page.goto('/');
    const hero = page.locator('section[aria-labelledby="hero-title"]');
    // Not a disk image on a PC: the button goes to the download card instead.
    await expect(hero.getByTestId('hero-download')).toHaveText('Download for Mac');
    await expect(hero.getByTestId('hero-download')).toHaveAttribute('href', '#download');
    await page.goto('/#download');
    await expect(page.getByTestId('download-dmg')).toBeVisible();
    await expect(page.getByTestId('download-exe')).toHaveCount(0);
  });
});

test.describe('landing on another computer', () => {
  test.use({ userAgent: LINUX_UA });

  test('shows both apps side by side', async ({ page }) => {
    await mockApi(page, { latest: latestDownload(), windows: windowsDownload() });
    await page.goto('/');
    const hero = page.locator('section[aria-labelledby="hero-title"]');
    await expect(hero.getByRole('link', { name: 'Download the app' })).toHaveAttribute('href', '#download');
    await expect(hero.getByRole('link', { name: 'all downloads' })).toHaveCount(0);
    await page.goto('/#download');
    await expect(page.getByTestId('download-card-macos')).toBeVisible();
    await expect(page.getByTestId('download-card-windows')).toBeVisible();
  });
});
