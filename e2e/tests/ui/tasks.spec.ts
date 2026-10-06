import { signUp } from '../../fixtures/auth';
import { demoMeeting } from '../../fixtures/data';
import { expect, test } from '../../fixtures/test';

test('tasks: every action item by due date, tick one off, jump to the meeting it came from', async ({ page, api }) => {
  await signUp(page);
  await page.getByRole('navigation', { name: 'App' }).first().getByRole('link', { name: 'Tasks' }).click();
  await expect(page).toHaveURL(/\/tasks$/);

  const overdue = page.getByRole('region', { name: 'Overdue' });
  await expect(overdue.getByText('Write the launch email')).toBeVisible();
  await expect(overdue.getByText('1 day late')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Later' }).getByText('Update the pricing page')).toBeVisible();

  // Ticking a task off goes through its meeting's PATCH.
  // (click, not check: the row leaves the open list as soon as the list refreshes)
  await page.getByRole('checkbox', { name: 'Update the pricing page' }).click();
  await expect.poll(() => api.callsTo('PATCH', /^\/meetings\//).at(-1)?.body).toEqual({ actionItem: { id: 'ai-2', done: true } });
  await expect(page.getByRole('checkbox', { name: 'Update the pricing page' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Show done tasks' }).click();
  await expect(page.getByRole('region', { name: 'Done' }).getByText('Update the pricing page')).toBeVisible();

  // The meeting link lands on that action item and highlights it.
  await overdue.getByRole('link', { name: /Pricing review/ }).click();
  await expect(page).toHaveURL(/\/meetings\/[^#]+#task-ai-1$/);
  const item = page.locator('#task-ai-1');
  await expect(item).toHaveAttribute('data-highlight', 'true');
  await expect(item).toBeInViewport();
});

test('tasks: an empty list says so', async ({ page, api }) => {
  api.meetings.push(demoMeeting({ summary: { ...demoMeeting().summary!, actionItems: [] } }));
  await signUp(page);
  await page.goto('/tasks');
  await expect(page.getByRole('heading', { name: 'No open tasks' })).toBeVisible();
});
