import { silentWav } from '../../fixtures/data';
import { signUp } from '../../fixtures/auth';
import { expect, test } from '../../fixtures/test';

test('upload an audio file: create → upload-url → PUT to storage → complete → meeting page polls to ready', async ({ page, api }) => {
  await signUp(page);
  await page.getByRole('link', { name: 'New recording' }).click();
  await expect(page.getByRole('heading', { name: 'New recording' })).toBeVisible();

  const wav = silentWav(2);
  await page.getByTestId('upload-input').setInputFiles({ name: 'standup.wav', mimeType: 'audio/wav', buffer: wav });
  // The file name is not used as the title: a title set at upload is kept, so the summarizer could not name it.
  await expect(page.getByLabel('Title (optional)')).toHaveValue('');
  await page.getByRole('button', { name: 'Upload and summarize' }).click();

  await expect(page).toHaveURL(/\/meetings\/[0-9a-f-]{36}$/);
  const create = api.callsTo('POST', /^\/meetings$/)[0];
  expect(create.body).toEqual({ source: 'upload' });
  const uploadUrl = api.callsTo('POST', /\/upload-url$/)[0];
  expect(uploadUrl.body).toEqual({ contentType: 'audio/wav', sizeBytes: wav.length });
  expect(api.uploads).toHaveLength(1);
  expect(api.uploads[0]).toMatchObject({ contentType: 'audio/wav', size: wav.length });
  expect(api.callsTo('POST', /\/complete$/)).toHaveLength(1);

  // Processing banner while polling, then the summary appears and polling stops.
  await expect(page.getByTestId('processing-banner')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Browser test: the summary arrived' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('processing-banner')).toHaveCount(0);
  const gets = api.callsTo('GET', /^\/meetings\/[^/]+$/).length;
  await page.waitForTimeout(3500);
  expect(api.callsTo('GET', /^\/meetings\/[^/]+$/).length).toBe(gets);
});

test('rejects files that are not audio before uploading anything', async ({ page, api }) => {
  await signUp(page);
  await page.goto('/record');
  await page.getByTestId('upload-input').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(page.getByText('That isn’t an audio format we take.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Upload and summarize' })).toBeDisabled();
  expect(api.callsTo('POST', /^\/meetings$/)).toHaveLength(0);
});
