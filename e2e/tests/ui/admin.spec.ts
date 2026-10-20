import { signUp } from '../../fixtures/auth';
import { expect, test } from '../../fixtures/test';

test('admins see usage, make another account an admin and set recording limits', async ({ page, api }) => {
  api.me = { ...api.me, isAdmin: true, isOwner: true };
  await signUp(page);
  await page.getByRole('link', { name: 'Admin' }).first().click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(page.getByText('42', { exact: true })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Meetings per day' }).getByRole('listitem')).toHaveCount(30);
  await page.getByRole('group', { name: 'Period' }).getByRole('button', { name: '7 days' }).click();
  await expect(page.getByRole('list', { name: 'Meetings per day' }).getByRole('listitem')).toHaveCount(7);

  await page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Users' }).click();
  await page.getByRole('link', { name: /ann@example.com/ }).click();
  await expect(page.getByRole('heading', { name: /ann@example.com/ })).toBeVisible();
  await page.getByRole('button', { name: 'Make admin' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Make admin' }).click();
  await expect(page.getByText(/made one by/)).toBeVisible();
  expect(api.callsTo('PATCH', /^\/admin\/users\//)[0].body).toEqual({ isAdmin: true });

  const limit = page.getByRole('form', { name: 'Recording limit' });
  await limit.getByRole('spinbutton', { name: 'Minutes' }).fill('45');
  await limit.getByRole('button', { name: 'Save limit' }).click();
  await expect(limit).toContainText('Now: 45 min');

  await page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Settings' }).click();
  const global = page.getByRole('region', { name: 'Recording limit' });
  await expect(global).toContainText('Now: 2 h');
  await global.getByRole('spinbutton', { name: 'Minutes' }).fill('90');
  await global.getByRole('button', { name: 'Save' }).click();
  await expect(global).toContainText('Now: 1 h 30 min');
  expect(api.callsTo('PATCH', /^\/admin\/settings$/)[0].body).toEqual({ recordingLimitMinutes: 90 });
  await expect(page.getByRole('list', { name: 'Admin list' })).toContainText('ann@example.com');

  await page.getByLabel('Add an admin').fill('nobody@example.com');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('sign in to BoringTalks once first');
});

test('everyone else sees no admin link, and the admin pages say so', async ({ page }) => {
  await signUp(page);
  await expect(page.getByRole('link', { name: 'Meetings' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Admin' })).toHaveCount(0);
  await page.goto('/admin/users');
  await expect(page.getByText('Only admins can see this.')).toBeVisible();
});
