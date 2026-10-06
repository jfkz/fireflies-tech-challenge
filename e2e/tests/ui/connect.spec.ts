import { PASSWORD, uniqueEmail } from '../../fixtures/auth';
import { expect, test } from '../../fixtures/test';

const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

test('a signed-out visitor signs in, approves the Mac and is sent to boringtalks://callback', async ({ page, api }) => {
  const target = `/connect?challenge=${CHALLENGE}&device=${encodeURIComponent('Mike’s MacBook Air')}`;
  await page.goto(target);
  await expect(page).toHaveURL(/\/signin\?next=%2Fconnect%3Fchallenge%3D/);

  // Come back through sign-up, which keeps `next`.
  await page.getByRole('link', { name: 'Create an account' }).click();
  await expect(page).toHaveURL(/\/signup\?next=%2Fconnect/);
  await page.getByLabel('Email').fill(uniqueEmail('mac'));
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page.getByRole('heading', { name: 'Connect Mike’s MacBook Air to your BoringTalks account?' })).toBeVisible();

  // No app handles boringtalks:// in the test browser, but Chromium still issues (and fails) the request: that's the hand-off.
  const launched = page.waitForRequest((r) => r.url() === 'boringtalks://callback?code=MOCK-CODE-1234', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Connect this Mac' }).click();

  await expect(page.getByRole('heading', { name: 'You can go back to the app.' })).toBeVisible();
  await expect(page.getByTestId('open-app')).toHaveAttribute('href', 'boringtalks://callback?code=MOCK-CODE-1234');
  await expect(page.getByTestId('device-code')).toHaveText('MOCK-CODE-1234');
  expect(api.callsTo('POST', /^\/devices\/authorize$/)[0].body).toEqual({ codeChallenge: CHALLENGE, deviceName: 'Mike’s MacBook Air' });
  expect((await launched).url()).toBe('boringtalks://callback?code=MOCK-CODE-1234');
});

test('declining sends boringtalks://callback?error=access_denied', async ({ page, api }) => {
  await page.goto('/signup?next=' + encodeURIComponent(`/connect?challenge=${CHALLENGE}&device=Mac`));
  await page.getByLabel('Email').fill(uniqueEmail('no'));
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  const launched = page.waitForRequest((r) => r.url() === 'boringtalks://callback?error=access_denied', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Not now' }).click();
  await launched;
  await expect(page.getByRole('heading', { name: 'Okay, not connected.' })).toBeVisible();
  expect(api.callsTo('POST', /^\/devices\/authorize$/)).toHaveLength(0);
});

test('a damaged challenge gets a friendly explanation and no API call', async ({ page, api }) => {
  await page.goto('/signup?next=' + encodeURIComponent('/connect?challenge=too-short&device=Mac'));
  await page.getByLabel('Email').fill(uniqueEmail('bad'));
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'This connect link doesn’t work' })).toBeVisible();
  expect(api.callsTo('POST', /^\/devices\/authorize$/)).toHaveLength(0);
});
