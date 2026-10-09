import { demoMeeting } from '../../fixtures/data';
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
  await expect(page.getByText('No meetings matching “zebra”.')).toBeVisible();
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

test('filter by a person or topic by clicking pills, then rename a speaker', async ({ page, api }) => {
  api.meetings.push(
    demoMeeting(),
    demoMeeting({ title: 'Hiring sync with Maya', speakers: ['You', 'Maya'], topics: ['Hiring'], startedAt: new Date(Date.now() - 26 * 3600_000).toISOString() }),
  );
  await signUp(page);
  const list = page.getByRole('list', { name: 'Meetings' });
  await expect(list.getByRole('heading')).toHaveCount(2);
  // A named person's chip in a row opens their page; labels like "Speaker 1" filter instead.
  await expect(list.getByRole('listitem').filter({ hasText: 'Hiring sync' }).getByRole('link', { name: 'Maya', exact: true })).toHaveAttribute('href', '/people/Maya');

  // A topic pill in a row filters the list, and the URL says so.
  const pricingRow = list.getByRole('listitem').filter({ hasText: 'Pricing review' });
  await pricingRow.getByRole('button', { name: /Pricing/ }).first().click();
  await expect(page).toHaveURL(/\/meetings\?topic=Pricing$/);
  await expect(list.getByRole('heading')).toHaveCount(1);
  expect(api.callsTo('GET', /^\/meetings$/).at(-1)?.query.topic).toBe('Pricing');

  // Swap to a person from the filter bar; clearing brings everything back.
  await page.getByRole('button', { name: /Pricing/ }).first().click();
  await expect(page).toHaveURL(/\/meetings$/);
  await page.getByRole('group', { name: 'Filters' }).getByRole('button', { name: 'Maya' }).click();
  await expect(page).toHaveURL(/speaker=Maya/);
  await expect(list.getByRole('heading')).toHaveCount(1);
  await expect(list.getByRole('link', { name: 'Hiring sync with Maya' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(list.getByRole('heading')).toHaveCount(2);

  // On a meeting, speaker chips link back to the filtered list; a speaker can be renamed.
  await list.getByRole('link', { name: /Pricing review/ }).click();
  const chips = page.getByRole('list', { name: 'Speakers and topics' });
  await expect(chips.getByRole('link', { name: /Launch Planning/ })).toHaveAttribute('href', '/meetings?topic=Launch+Planning');
  await chips.getByRole('button', { name: 'Rename speakers' }).click();
  await page.getByLabel('Speaker 1', { exact: true }).fill('Dana');
  await page.getByRole('button', { name: 'Save names' }).click();
  await expect(chips.getByRole('link', { name: /Dana/ })).toBeVisible();
  expect(api.callsTo('PATCH', /^\/meetings\//).at(-1)?.body).toEqual({ speakers: { 'Speaker 1': 'Dana' } });
});

test('link a meeting to another one by hand, then take it out of the chain', async ({ page, api }) => {
  const earlier = demoMeeting({ title: 'Pricing kickoff', startedAt: new Date(Date.now() - 6 * 86_400_000).toISOString() });
  api.meetings.push(demoMeeting(), earlier);
  await signUp(page);
  await page.getByRole('list', { name: 'Meetings' }).getByRole('link', { name: /Pricing review/ }).click();
  await expect(page.getByTestId('meeting-chain')).toHaveCount(0);

  await page.getByRole('button', { name: 'Link to…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Link to another meeting' });
  await expect(dialog.getByRole('searchbox', { name: 'Search meetings' })).toBeFocused();
  // Escape closes it; nothing is sent.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  await page.getByRole('button', { name: 'Link to…' }).click();
  await dialog.getByRole('searchbox', { name: 'Search meetings' }).fill('kickoff');
  await dialog.getByRole('button', { name: /Pricing kickoff/ }).click();
  await expect(dialog).toBeHidden();
  expect(api.callsTo('PATCH', /^\/meetings\//).at(-1)?.body).toEqual({ chain: { with: earlier.id } });
  const bar = page.getByTestId('meeting-chain');
  await expect(bar).toContainText('Chain · 2 of 2');
  await expect(bar.getByRole('link', { name: 'Previous in chain: Pricing kickoff' })).toBeVisible();

  await bar.getByRole('button', { name: 'Remove from chain' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove from chain' }).click();
  await expect(page.getByTestId('meeting-chain')).toHaveCount(0);
});
