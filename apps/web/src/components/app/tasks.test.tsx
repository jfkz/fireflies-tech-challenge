import type { TaskItem, TaskPage } from '@boringtalks/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authValue, fakeApi, meeting, renderWithProviders } from '@/test/utils';
import { CalendarView } from './CalendarView';
import { TasksView } from './TasksView';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/tasks',
  useSearchParams: () => new URLSearchParams(),
}));

const ME = { id: '00000000-0000-4000-8000-000000000009', email: 'me@example.com', name: 'Ann', emailOnReady: true, createdAt: '2026-10-01T10:00:00.000Z' };
const M1 = { id: '00000000-0000-4000-8000-000000000001', title: 'Pricing review', startedAt: '2026-10-05T10:00:00.000Z' };

const task = (id: string, dueDate: string | null, owner: string | null, done = false): TaskItem => ({ id, text: `Task ${id}`, owner, due: dueDate ? 'Friday' : null, dueDate, done, meeting: M1 });

beforeEach(() => {
  // Only the clock is fake, so React Query and Testing Library still run on real timers.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-07T12:00:00'));
});
afterEach(() => vi.useRealTimers());

describe('TasksView', () => {
  function setup(open: TaskItem[], done: TaskItem[] = []) {
    // Behaves like the API: ticking a task moves it from the open list to the done list.
    let all = [...open, ...done];
    const listTasks = vi.fn(async ({ status }: { status?: string }): Promise<TaskPage> => ({ items: all.filter((t) => t.done === (status === 'done')), nextCursor: null }));
    const updateMeeting = vi.fn(async (_id: string, body: { actionItem?: { id: string; done: boolean } }) => {
      all = all.map((t) => (t.id === body.actionItem?.id ? { ...t, done: body.actionItem.done } : t));
      return meeting();
    });
    renderWithProviders(<TasksView />, { auth: authValue({ api: fakeApi({ me: vi.fn(async () => ME), listTasks: listTasks as never, updateMeeting }) }) });
    return { listTasks, updateMeeting };
  }

  it('groups open tasks by when they are due and links each to its meeting', async () => {
    setup([task('a', '2026-10-05', 'Maya'), task('b', '2026-10-07', 'Ann'), task('c', '2026-10-20', 'Maya'), task('d', null, null)]);
    const overdue = await screen.findByRole('region', { name: 'Overdue' });
    expect(within(overdue).getByText('2 days late')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Today' })).getByText('Task b')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Later' })).getByText('Due Tue, Oct 20')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'No date' })).getByText('Task d')).toBeInTheDocument();
    expect(within(overdue).getByRole('link', { name: 'Pricing review' })).toHaveAttribute('href', `/meetings/${M1.id}#task-a`);
  });

  it('filters by owner and ticks a task off through its meeting', async () => {
    const { updateMeeting } = setup([task('a', '2026-10-05', 'Maya'), task('b', '2026-10-07', 'Ann'), task('c', '2026-10-20', 'Maya')]);
    const owners = await screen.findByRole('group', { name: 'Whose tasks' });
    fireEvent.click(within(owners).getByRole('button', { name: /Ann/ }));
    expect(screen.queryByText('Task a')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Task b' }));
    await waitFor(() => expect(updateMeeting).toHaveBeenCalledWith(M1.id, { actionItem: { id: 'b', done: true } }));
    // Ticked at once; after the refresh it has left the open list.
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: 'Task b' })).toBeNull());
    fireEvent.click(within(screen.getByRole('group', { name: 'Whose tasks' })).getByRole('button', { name: 'Everyone' }));
    expect(screen.getByText('Task a')).toBeInTheDocument();
  });

  it('shows done tasks on request, and a friendly empty state', async () => {
    const { listTasks } = setup([], [task('z', null, 'Leo', true)]);
    expect(await screen.findByText('No open tasks')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show done tasks' }));
    expect(await screen.findByText('Task z')).toBeInTheDocument();
    expect(listTasks).toHaveBeenCalledWith(expect.objectContaining({ status: 'done' }), expect.anything());
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(screen.queryByText('Task z')).toBeNull();
  });
});

describe('CalendarView', () => {
  it('shows totals, a year heatmap, the month, and the meetings of a picked day', async () => {
    const meetingStats = vi.fn(async (q: { from: string; to: string; tz: string }) => ({
      tz: q.tz,
      days: [
        { date: '2026-10-06', count: 2, totalSec: 5400 },
        { date: '2026-09-02', count: 1, totalSec: 1800 },
      ].filter((d) => d.date >= q.from && d.date < q.to),
    }));
    const listMeetings = vi.fn(async () => ({ items: [{ ...meeting(), actionItemCount: 0 }], nextCursor: null }));
    renderWithProviders(<CalendarView />, { auth: authValue({ api: fakeApi({ me: vi.fn(async () => ME), meetingStats, listMeetings: listMeetings as never }) }) });

    const stats = await screen.findByText('This week');
    await waitFor(() => expect(stats.parentElement).toHaveTextContent('1 h 30 min2 meetings'));
    expect(screen.getByText('Busiest day').parentElement).toHaveTextContent('Tue, Oct 6');
    expect(screen.getByTestId('heatmap').querySelectorAll('[data-level="3"]')).toHaveLength(1);

    // Pick a day in the month view: its meetings load for that local day.
    const month = screen.getByRole('region', { name: 'October 2026' });
    fireEvent.click(within(month).getByRole('button', { name: 'Tue, Oct 6: 2 meetings, 1 h 30 min' }));
    expect(await screen.findByRole('region', { name: 'Meetings on Tuesday, October 6' })).toBeInTheDocument();
    expect(listMeetings).toHaveBeenLastCalledWith(
      expect.objectContaining({ from: new Date('2026-10-06T00:00:00').toISOString(), to: new Date('2026-10-07T00:00:00').toISOString() }),
      expect.anything(),
    );

    // Page back a month: it asks for September's numbers.
    fireEvent.click(within(month).getByRole('button', { name: 'Previous month' }));
    expect(await screen.findByRole('region', { name: 'September 2026' })).toBeInTheDocument();
    await waitFor(() => expect(meetingStats).toHaveBeenCalledWith(expect.objectContaining({ from: '2026-09-01', to: '2026-10-01' }), expect.anything()));
  });
});
