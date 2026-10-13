import { PASSWORD, signUp } from '../../fixtures/auth';
import { expect, test } from '../../fixtures/test';

const EMULATOR = 'http://127.0.0.1:9099/emulator/v1/projects/demo-boringtalks/oobCodes';

type OobCode = { email: string; requestType: string; oobCode: string; oobLink: string };

test('forgot password: the email link opens our own page, which sets the new password and signs in', async ({ page, request }) => {
  const email = await signUp(page);
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto(`/reset?email=${encodeURIComponent(email)}`);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('status')).toContainText('a reset link is on its way');

  // What the email would have said: the emulator keeps the codes it "sent".
  const codes = (await (await request.get(EMULATOR)).json()) as { oobCodes: OobCode[] };
  const sent = codes.oobCodes.filter((c) => c.email === email && c.requestType === 'PASSWORD_RESET').at(-1);
  expect(sent).toBeTruthy();
  const continueUrl = new URL(sent!.oobLink).searchParams.get('continueUrl');
  expect(continueUrl).toMatch(/\/signin$/);

  await page.goto(`/auth/action?mode=resetPassword&oobCode=${sent!.oobCode}&continueUrl=${encodeURIComponent(continueUrl!)}`);
  await expect(page.getByText(`For ${email}.`)).toBeVisible();
  await page.getByLabel('New password').fill(`${PASSWORD}-2`);
  await page.getByRole('button', { name: 'Save password' }).click();
  await expect(page).toHaveURL(/\/meetings$/);

  // The link works once.
  await page.goto(`/auth/action?mode=resetPassword&oobCode=${sent!.oobCode}`);
  await expect(page.getByText(/already used/)).toBeVisible();
});
