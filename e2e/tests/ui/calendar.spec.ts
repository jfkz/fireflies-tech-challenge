import { signUp } from '../../fixtures/auth';
import { demoMeeting } from '../../fixtures/data';
import { expect, test } from '../../fixtures/test';

test('calendar: totals, a heatmap of the year, and the meetings of a picked day', async ({ page, api }) => {
  const now = Date.now();
  api.meetings.push(
    demoMeeting({ title: 'Long planning session', durationSec: 2 * 3600, startedAt: new Date(now - 3600_000).toISOString() }),
    demoMeeting({ title: 'Standup', durationSec: 15 * 60, startedAt: new Date(now - 2 * 3600_000).toISOString() }),
  );
  await signUp(page);
  await page.goto('/calendar');

  await expect(page.getByRole('heading', { level: 1, name: 'Calendar' })).toBeVisible();
  // Today: two meetings, 2 h 15 min.
  await expect(page.getByText('This week').locator('..')).toContainText('2 h 15 min');
  await expect(page.getByTestId('heatmap').locator('[data-level="3"]')).toHaveCount(1);

  // Click today in the month view: its meetings are listed and link to their pages.
  const month = page.getByRole('region', { name: /^[A-Z][a-z]+ \d{4}$/ });
  await month.getByRole('button', { name: /2 meetings, 2 h 15 min/ }).click();
  const day = page.getByRole('region', { name: /^Meetings on / });
  await expect(day.getByRole('link', { name: 'Long planning session' })).toBeVisible();
  await expect(day.getByRole('link', { name: 'Standup' })).toBeVisible();
  const call = api.callsTo('GET', /^\/meetings$/).at(-1)!;
  expect(call.query.from).toBeTruthy();
  expect(call.query.to).toBeTruthy();
});
