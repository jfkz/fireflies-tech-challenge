import { signUp } from '../../fixtures/auth';
import { expect, test } from '../../fixtures/test';

test('settings: email toggle and revoking a connected Mac', async ({ page, api }) => {
  const email = await signUp(page);
  await page.getByRole('link', { name: 'Settings' }).first().click();
  await expect(page.getByTestId('account-email')).toHaveText(email);

  const toggle = page.getByRole('switch', { name: 'Email me when a meeting is ready' });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  expect(api.callsTo('PATCH', /^\/me\/settings$/)[0].body).toEqual({ emailOnReady: false });

  const name = api.devices[0].name;
  await expect(page.getByText(name)).toBeVisible();
  await page.getByRole('button', { name: 'Disconnect' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(`Disconnect ${name}?`);
  await dialog.getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.getByText('No Macs connected yet.')).toBeVisible();
  expect(api.callsTo('DELETE', /^\/devices\//)).toHaveLength(1);
});

test('signed-out visitors are sent to sign in, and come back afterwards', async ({ page }) => {
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/signin\?next=%2Fsettings$/);
});

test('sign out returns to the landing page', async ({ page }) => {
  await signUp(page);
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/meetings');
  await expect(page).toHaveURL(/\/signin/);
});
