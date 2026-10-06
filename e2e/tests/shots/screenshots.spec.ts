import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, type Page } from '@playwright/test';
import { signUp } from '../../fixtures/auth';
import { demoMeeting, latestDownload } from '../../fixtures/data';
import { mockApi } from '../../fixtures/mockApi';

const OUT = process.env.SHOTS_DIR ?? join(import.meta.dirname, '../../screenshots');
mkdirSync(OUT, { recursive: true });

const SIZES = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 375, height: 780 },
] as const;

async function shot(page: Page, name: string) {
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
}

for (const size of SIZES) {
  test(`landing ${size.name}`, async ({ page }) => {
    await page.setViewportSize(size);
    await mockApi(page, { latest: latestDownload({ notarized: false }) });
    await page.goto('/');
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    const stops = [0, 0.09, 0.15, 0.22, 0.3, 0.37, 0.44, 0.52, 0.6, 0.7, 0.8, 1];
    for (const [i, f] of stops.entries()) {
      await page.evaluate((y) => window.scrollTo(0, y), Math.round(f * (height - size.height)));
      await shot(page, `landing-${size.name}-${String(i).padStart(2, '0')}`);
    }
  });

  test(`landing reduced motion ${size.name}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mockApi(page, { latest: null });
    await page.goto('/');
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(OUT, `landing-${size.name}-reduced-full.png`), fullPage: true });
  });

  test(`dashboard ${size.name}`, async ({ page }) => {
    await page.setViewportSize(size);
    const processing = demoMeeting({ title: 'Untitled meeting', status: 'transcribing', summary: null, segments: [], audioUrl: null, description: null, speakers: [], source: 'browser' });
    const api = await mockApi(page, { latest: latestDownload() });
    api.progression = ['transcribing'];
    await page.goto('/signin');
    await shot(page, `signin-${size.name}`);
    await page.getByLabel('Password').focus();
    await shot(page, `signin-${size.name}-password`);
    await signUp(page);
    api.meetings.push(processing);
    await page.reload();
    await page.getByRole('link', { name: /Pricing review/ }).waitFor();
    await shot(page, `meetings-${size.name}`);
    await page.getByRole('link', { name: /Pricing review/ }).click();
    await page.getByRole('heading', { name: 'Key topics' }).waitFor();
    await page.getByRole('button', { name: /Play from 0:16/ }).click();
    await shot(page, `meeting-${size.name}`);
    await page.screenshot({ path: join(OUT, `meeting-${size.name}-full.png`), fullPage: true });
    await page.goto(`/meetings/${processing.id}`);
    await page.getByTestId('processing-banner').waitFor();
    await shot(page, `meeting-processing-${size.name}`);
    await page.goto('/record');
    await shot(page, `record-${size.name}`);
    await page.goto('/settings');
    await page.getByText('Studio').or(page.getByText('MacBook')).first().waitFor();
    await shot(page, `settings-${size.name}`);
    await page.goto('/connect?challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&device=Mike%E2%80%99s%20MacBook%20Air');
    await page.getByRole('button', { name: 'Connect this Mac' }).waitFor();
    await shot(page, `connect-${size.name}`);
    await page.getByRole('button', { name: 'Connect this Mac' }).click();
    await page.getByTestId('device-code').waitFor();
    await shot(page, `connect-done-${size.name}`);
    await page.goto('/this-does-not-exist');
    await shot(page, `404-${size.name}`);
  });

  test(`tasks and calendar ${size.name}`, async ({ page }) => {
    await page.setViewportSize(size);
    const api = await mockApi(page, { latest: latestDownload() });
    const day = (n: number, h = 10) => new Date(Date.now() - n * 86_400_000 + (h - new Date().getHours()) * 3600_000).toISOString();
    api.meetings.push(demoMeeting());
    // A plausible few months of meetings for the heatmap.
    for (let i = 1; i < 120; i++) {
      if (i % 7 === 5 || i % 7 === 6 || (i * 37) % 11 < 4) continue;
      const n = 1 + ((i * 13) % 4);
      for (let k = 0; k < n; k++) {
        api.meetings.push(demoMeeting({ title: `Sync ${i}.${k}`, durationSec: 900 + ((i * 7 + k * 13) % 6) * 900, startedAt: day(i, 9 + k), summary: null }));
      }
    }
    await signUp(page);
    await page.goto('/tasks');
    await page.getByRole('region', { name: 'Overdue' }).waitFor();
    await shot(page, `tasks-${size.name}`);
    await page.goto('/calendar');
    await page.getByTestId('heatmap').waitFor();
    const month = page.getByRole('region', { name: /^[A-Z][a-z]+ \d{4}$/ });
    await month.getByRole('button', { name: /meetings?,/ }).first().click();
    await shot(page, `calendar-${size.name}`);
    await page.screenshot({ path: join(OUT, `calendar-${size.name}-full.png`), fullPage: true });
  });
}
