import type { PeopleList, PersonDetail, TaskItem } from '@boringtalks/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '@/lib/api';
import { authValue, fakeApi, meeting, renderWithProviders } from '@/test/utils';
import { PeopleView } from './PeopleView';
import { PersonView } from './PersonView';

const nav = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  search: new URLSearchParams(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => nav.router,
  usePathname: () => '/people',
  useSearchParams: () => nav.search,
}));

const ME = { id: '00000000-0000-4000-8000-000000000009', email: 'me@example.com', name: 'Ann', emailOnReady: true, createdAt: '2026-10-01T10:00:00.000Z' };
const M1 = { id: '00000000-0000-4000-8000-000000000001', title: 'Pricing review', startedAt: '2026-10-05T10:00:00.000Z' };
const M2 = { id: '00000000-0000-4000-8000-000000000002', title: 'Kickoff', startedAt: '2026-09-20T10:00:00.000Z' };

const person = (name: string, togetherSec: number, extra: Partial<PersonDetail> = {}) => ({
  name,
  meetingCount: 3,
  togetherSec,
  talkSec: Math.round(togetherSec * 0.38),
  lastMetAt: '2026-10-04T10:00:00.000Z',
  openTasks: 0,
  ...extra,
});

beforeEach(() => {
  nav.router.push.mockReset();
  nav.router.replace.mockReset();
  nav.search = new URLSearchParams();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-07T12:00:00'));
});
afterEach(() => vi.useRealTimers());

describe('PeopleView', () => {
  function setup(list: (days?: number) => PeopleList) {
    const listPeople = vi.fn(async (days?: number) => list(days));
    renderWithProviders(<PeopleView />, { auth: authValue({ api: fakeApi({ me: vi.fn(async () => ME), listPeople: listPeople as never }) }) });
    return { listPeople };
  }

  it('ranks people by time together, with bars relative to the top person', async () => {
    const { listPeople } = setup(() => ({
      since: '2026-09-07T00:00:00.000Z',
      meetingSec: 36_000,
      people: [person('Maya', 15_000, { openTasks: 2 }), person('Leo Park', 3_600, { meetingCount: 1 })],
    }));
    const list = await screen.findByRole('list', { name: 'People, most time together first' });
    expect(listPeople).toHaveBeenCalledWith(30, expect.anything());
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((r) => within(r).getByRole('link').textContent)).toEqual(['Maya', 'Leo Park']);
    expect(within(rows[0]).getByRole('link')).toHaveAttribute('href', '/people/Maya');
    expect(within(rows[1]).getByRole('link')).toHaveAttribute('href', '/people/Leo%20Park');
    expect(rows[0]).toHaveTextContent('4 h 10 min together·3 meetings·talks 38%2 open tasks');
    expect(rows[0]).toHaveTextContent('Last met 3 days ago');
    expect(rows[1]).toHaveTextContent('1 meeting');
    expect(screen.getAllByTestId('together-bar').map((b) => b.style.width)).toEqual(['100%', '24%']);
    expect(screen.getByTestId('people-overview')).toHaveTextContent('You spent 10 h in meetings in the last 30 days, with 2 people who have names. Most of it with Maya: 4 h 10 min.');
  });

  it('switches the period through the URL', async () => {
    nav.search = new URLSearchParams('days=all');
    const { listPeople } = setup(() => ({ since: null, meetingSec: 3600, people: [person('Maya', 3600)] }));
    await screen.findByRole('list', { name: /People/ });
    expect(listPeople).toHaveBeenCalledWith(undefined, expect.anything());
    const period = screen.getByRole('group', { name: 'Period' });
    expect(within(period).getByRole('button', { name: 'All time' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('people-overview')).toHaveTextContent('in meetings so far, with 1 person');
    fireEvent.click(within(period).getByRole('button', { name: '90 days' }));
    expect(nav.router.push).toHaveBeenLastCalledWith('/people?days=90', { scroll: false });
    fireEvent.click(within(period).getByRole('button', { name: '30 days' }));
    expect(nav.router.push).toHaveBeenLastCalledWith('/people', { scroll: false });
  });

  it('explains where people come from when there are none', async () => {
    setup(() => ({ since: '2026-09-07T00:00:00.000Z', meetingSec: 0, people: [] }));
    expect(await screen.findByRole('heading', { name: 'Nobody in the last 30 days' })).toBeInTheDocument();
    expect(screen.getByText(/rename “Speaker 2”/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Show all time' })).toHaveAttribute('href', '/people?days=all');
  });

  it('shows errors with a retry', async () => {
    renderWithProviders(<PeopleView />, {
      auth: authValue({ api: fakeApi({ me: vi.fn(async () => ME), listPeople: vi.fn(async () => Promise.reject(new Error('People asleep'))) }) }),
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('People asleep');
  });
});

describe('PersonView', () => {
  const task = (id: string, done: boolean, meetingRef = M1): TaskItem => ({ id, text: `Task ${id}`, owner: 'Maya', due: null, dueDate: null, done, meeting: meetingRef });
  const maya = (): PersonDetail => ({
    ...person('Maya', 15_000, { openTasks: 1 }),
    meetings: [
      { ...M1, durationSec: 1800, talkSec: 600 },
      { ...M2, durationSec: 3600, talkSec: 1500 },
    ],
    topics: [{ value: 'Pricing', count: 2 }],
    tasks: [task('t1', false), task('t2', true, M2)],
  });

  function setup(extra: Parameters<typeof fakeApi>[0] = {}) {
    const api = fakeApi({ getPerson: vi.fn(async () => maya()), ...extra });
    renderWithProviders(<PersonView name="Maya" />, { auth: authValue({ api }) });
    return api;
  }

  it('shows stats, topics, open tasks and the meetings together', async () => {
    setup();
    expect(await screen.findByRole('heading', { level: 1, name: 'Maya' })).toBeInTheDocument();
    expect(screen.getByText('Time together').parentElement).toHaveTextContent('4 h 10 minin 3 meetings');
    expect(screen.getByText('Meetings').parentElement).toHaveTextContent('3since Sep 20');
    expect(screen.getByText('Their talk time').parentElement).toHaveTextContent('1 h 35 min38% of the time');
    expect(screen.getByText('Last met').parentElement).toHaveTextContent('3 days ago');
    expect(within(screen.getByRole('region', { name: 'Topics' })).getByRole('link', { name: /Pricing/ })).toHaveAttribute('href', '/meetings?topic=Pricing');

    const tasks = screen.getByRole('region', { name: 'Their tasks' });
    expect(within(tasks).getByText('Task t1')).toBeInTheDocument();
    expect(within(tasks).queryByText('Task t2')).toBeNull();
    expect(within(tasks).getByText('and 1 done')).toBeInTheDocument();
    expect(within(tasks).getByRole('link', { name: 'Pricing review' })).toHaveAttribute('href', `/meetings/${M1.id}#task-t1`);

    const meetings = screen.getByRole('region', { name: 'Meetings together' });
    expect(within(meetings).getAllByRole('link').map((l) => l.getAttribute('href'))).toEqual([`/meetings/${M1.id}`, `/meetings/${M2.id}`]);
    expect(within(meetings).getAllByRole('listitem')[1]).toHaveTextContent('1 h · talked 25 min');
  });

  it('ticks a task off through its meeting', async () => {
    // Behaves like the API: once the PATCH lands, the person comes back with the task done.
    let saved = false;
    let land!: () => void;
    const api = setup({
      getPerson: vi.fn(async () => (saved ? { ...maya(), tasks: maya().tasks.map((t) => ({ ...t, done: true })) } : maya())),
      updateMeeting: vi.fn(() => new Promise<ReturnType<typeof meeting>>((resolve) => (land = () => ((saved = true), resolve(meeting()))))),
    });
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Task t1' }));
    await waitFor(() => expect(api.updateMeeting).toHaveBeenCalledWith(M1.id, { actionItem: { id: 't1', done: true } }));
    // Ticked at once, before the server answers.
    expect(screen.getByRole('checkbox', { name: 'Task t1' })).toBeChecked();
    land();
    // After the refresh it stays on the page, struck through, until you come back.
    await waitFor(() => expect(api.getPerson).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('checkbox', { name: 'Task t1' })).toBeChecked();
    expect(screen.getByText('and 1 done')).toBeInTheDocument();
  });

  it('renames (or merges) and moves to the new name', async () => {
    const api = setup({ renamePerson: vi.fn(async () => ({ ...maya(), name: 'Maya Chen' })) });
    fireEvent.click(await screen.findByRole('button', { name: 'Rename or merge' }));
    const form = screen.getByRole('form', { name: 'Rename or merge' });
    fireEvent.change(within(form).getByRole('textbox'), { target: { value: ' Maya Chen ' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith('/people/Maya%20Chen'));
    expect(api.renamePerson).toHaveBeenCalledWith('Maya', 'Maya Chen');

    // The same name just closes the form.
    fireEvent.click(screen.getByRole('button', { name: 'Rename or merge' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.queryByRole('form', { name: 'Rename or merge' })).toBeNull();
    expect(api.renamePerson).toHaveBeenCalledTimes(1);
  });

  it('shows a failed rename in the form', async () => {
    setup({ renamePerson: vi.fn(async () => Promise.reject(new ApiRequestError('Name too long', 400))) });
    fireEvent.click(await screen.findByRole('button', { name: 'Rename or merge' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'M' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Name too long');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'Rename or merge' })).toBeNull();
  });

  it('says when nobody has that name, and shows other errors', async () => {
    setup({ getPerson: vi.fn(async () => Promise.reject(new ApiRequestError('Not found', 404))) });
    expect(await screen.findByRole('heading', { name: 'No one called Maya' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See everyone' })).toHaveAttribute('href', '/people');
  });

  it('shows other errors with a retry', async () => {
    setup({ getPerson: vi.fn(async () => Promise.reject(new ApiRequestError('Server sad', 500))) });
    expect(await screen.findByRole('alert')).toHaveTextContent('Server sad');
  });
});
