import { signUp } from '../../fixtures/auth';
import { expect, test } from '../../fixtures/test';

test('sign up → demo meeting → detail → toggle action item → seek audio', async ({ page, api }) => {
  await signUp(page);

  // GET /me ran first (it creates the account and the demo meeting), then the list.
  await expect(page.getByRole('link', { name: /Pricing review: Pro to \$29, launch Nov 3/ })).toBeVisible();
  const meCall = api.calls.findIndex((c) => c.path === '/me');
  const listCall = api.calls.findIndex((c) => c.path === '/meetings' && c.method === 'GET');
  expect(meCall).toBeGreaterThanOrEqual(0);
  expect(listCall).toBeGreaterThan(meCall);
  expect(api.calls[listCall].headers.authorization).toMatch(/^Bearer .+/);
  await expect(page.getByText('2 action items')).toBeVisible();

  await page.getByRole('link', { name: /Pricing review/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Pricing review: Pro to $29, launch Nov 3' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Key topics' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Decisions' })).toContainText('Annual plan stays at $240');

  // Toggle an action item: optimistic tick + PATCH with the shared request shape.
  const box = page.getByRole('checkbox', { name: /Write the launch email/ });
  await box.click();
  await expect(box).toBeChecked();
  await expect.poll(() => api.callsTo('PATCH', /^\/meetings\/[^/]+$/).at(-1)?.body).toEqual({ actionItem: { id: 'ai-1', done: true } });
  await expect(page.getByText('1 of 2 done')).toBeVisible();

  // Consecutive segments by the same speaker are merged (9 segments → 8 turns).
  const transcript = page.getByTestId('transcript');
  await expect(transcript.locator('li')).toHaveCount(8);

  // Click a segment: the audio seeks there and the segment is highlighted.
  await page.getByRole('button', { name: 'Play from 0:16: Speaker 2' }).click();
  await expect(transcript.locator('li[data-active]')).toContainText('Then the launch email has to go out');
  const t = await page.getByTestId('meeting-audio').evaluate((a: HTMLAudioElement) => a.currentTime);
  expect(t).toBeGreaterThanOrEqual(16);
  expect(t).toBeLessThan(23);

  // Rename inline.
  await page.getByRole('button', { name: 'Rename meeting' }).click();
  await page.getByLabel('Meeting title').fill('Pricing, finally');
  await page.getByLabel('Meeting title').press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Pricing, finally' })).toBeVisible();
  expect(api.callsTo('PATCH', /^\/meetings\//).at(-1)?.body).toEqual({ title: 'Pricing, finally' });
});

test('search is debounced and sends q', async ({ page, api }) => {
  await signUp(page);
  await expect(page.getByRole('link', { name: /Pricing review/ })).toBeVisible();
  const before = api.callsTo('GET', /^\/meetings$/).length;

  await page.getByLabel('Search meetings').pressSequentially('zebra', { delay: 30 });
  await expect(page.getByText('Nothing matches “zebra”.')).toBeVisible();
  const searches = api.callsTo('GET', /^\/meetings$/).slice(before);
  // One request for the whole word, not one per keystroke.
  expect(searches.map((c) => c.query.q)).toEqual(['zebra']);

  await page.getByLabel('Search meetings').fill('launch email');
  await expect(page.getByRole('link', { name: /Pricing review/ })).toBeVisible();
  expect(api.callsTo('GET', /^\/meetings$/).at(-1)?.query.q).toBe('launch email');
});

test('delete asks in an in-page dialog, then removes the meeting', async ({ page, api }) => {
  await signUp(page);
  await page.getByRole('link', { name: /Pricing review/ }).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete this meeting?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Delete meeting' }).click();
  await expect(page).toHaveURL(/\/meetings$/);
  await expect(page.getByRole('heading', { name: 'No meetings yet' })).toBeVisible();
  expect(api.callsTo('DELETE', /^\/meetings\//)).toHaveLength(1);
});
