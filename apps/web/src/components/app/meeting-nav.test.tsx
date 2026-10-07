import type { MeetingChain, MeetingDetail } from '@boringtalks/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authValue, fakeApi, meeting, renderWithProviders } from '@/test/utils';
import { MeetingView } from './MeetingView';

const nav = vi.hoisted(() => ({ router: { push: vi.fn(), replace: vi.fn() } }));
vi.mock('next/navigation', () => ({
  useRouter: () => nav.router,
  usePathname: () => '/meetings/x',
  useSearchParams: () => new URLSearchParams(),
}));

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
// The meeting on screen starts at 10:00 local time; two others share its day.
const at = (time: string) => new Date(`2026-10-01T${time}:00`).toISOString();
const EARLY = { ...meeting({ id: id(1), title: 'Standup', startedAt: at('09:00') }), actionItemCount: 0 };
const LATE = { ...meeting({ id: id(3), title: 'Retro', startedAt: at('16:00') }), actionItemCount: 0 };
const ME = { id: '00000000-0000-4000-8000-000000000009', email: 'me@example.com', name: 'Ann Lee', emailOnReady: true, createdAt: '2026-10-01T10:00:00.000Z' };

const chain = (ids: number[], reason: string | null = 'Follows up on the pricing plan'): MeetingChain => ({
  id: '00000000-0000-4000-8000-0000000000c1',
  reason,
  meetings: ids.map((n) => ({ id: id(n), title: `Pricing ${n}`, startedAt: `2026-09-2${n}T10:00:00.000Z` })),
});

beforeEach(() => {
  nav.router.push.mockReset();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-07T12:00:00'));
});
afterEach(() => vi.useRealTimers());

function setup(m: MeetingDetail, sameDay = [EARLY, LATE], extra: Parameters<typeof fakeApi>[0] = {}) {
  const current = { ...m, actionItemCount: 2 };
  const listMeetings = vi.fn(async () => ({ items: [LATE, current, EARLY].filter((x) => x.id === m.id || sameDay.includes(x)), nextCursor: null }));
  const api = fakeApi({ getMeeting: vi.fn(async () => m), listMeetings: listMeetings as never, ...extra });
  renderWithProviders(<MeetingView id={m.id} />, { auth: authValue({ api }) });
  return api;
}

describe('Meeting navigation', () => {
  it('steps to the meetings before and after on the same local day', async () => {
    const api = setup(meeting({ id: id(2), startedAt: at('10:00') }));
    const day = await screen.findByRole('group', { name: 'Meetings that day' });
    expect(within(screen.getByRole('navigation', { name: 'Meeting navigation' })).getByRole('link', { name: /All meetings/ })).toHaveAttribute('href', '/meetings');
    expect(within(day).getByRole('link', { name: 'Previous that day: Standup' })).toHaveAttribute('href', `/meetings/${id(1)}`);
    expect(within(day).getByRole('link', { name: 'Next that day: Retro' })).toHaveAttribute('href', `/meetings/${id(3)}`);
    expect(day).toHaveTextContent('2 of 3 that day');
    expect(api.listMeetings).toHaveBeenCalledWith({ from: new Date('2026-10-01T00:00:00').toISOString(), to: new Date('2026-10-02T00:00:00').toISOString(), limit: 100 }, expect.anything());
    // No chain, no chain bar.
    expect(screen.queryByTestId('meeting-chain')).toBeNull();
  });

  it('greys out the step past the end of the day', async () => {
    setup(meeting({ id: id(3), title: 'Retro', startedAt: at('16:00') }));
    const day = await screen.findByRole('group', { name: 'Meetings that day' });
    expect(within(day).getByText(/Next that day/)).toHaveAttribute('aria-disabled', 'true');
    expect(within(day).getByRole('link', { name: 'Previous that day: Standup' })).toBeInTheDocument();
  });

  it('says "today" for today’s meetings and shows nothing when it was the only one', async () => {
    setup(meeting({ id: id(2), startedAt: new Date('2026-10-07T09:00:00').toISOString() }), []);
    await screen.findByRole('heading', { level: 1 });
    await waitFor(() => expect(screen.queryByRole('group', { name: /Meetings today/ })).toBeNull());
  });

  it('shows the chain: position, reason, neighbours and the whole list', async () => {
    setup(meeting({ id: id(2), startedAt: at('10:00'), chain: chain([1, 2, 4, 5]) }));
    const bar = await screen.findByTestId('meeting-chain');
    expect(bar).toHaveTextContent('Chain · 2 of 4');
    expect(bar).toHaveTextContent('Follows up on the pricing plan');
    expect(within(bar).getByRole('link', { name: 'Previous in chain: Pricing 1' })).toHaveAttribute('href', `/meetings/${id(1)}`);
    expect(within(bar).getByRole('link', { name: 'Next in chain: Pricing 4' })).toHaveAttribute('href', `/meetings/${id(4)}`);

    const toggle = within(bar).getByRole('button', { name: 'Show all 4' });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const list = within(bar).getByRole('list', { name: 'Meetings in this chain' });
    expect(within(list).getAllByRole('link').map((l) => l.textContent)).toEqual(['Pricing 1', 'Pricing 4', 'Pricing 5']);
    expect(within(list).getByText('Pricing 2')).toHaveAttribute('aria-current', 'page');
    fireEvent.click(within(bar).getByRole('button', { name: 'Hide the chain' }));
    expect(within(bar).queryByRole('list')).toBeNull();
  });

  it('removes the meeting from its chain after confirming', async () => {
    const m = meeting({ id: id(2), startedAt: at('10:00'), chain: chain([1, 2], null) });
    const api = setup(m, [EARLY, LATE], { updateMeeting: vi.fn(async () => ({ ...m, chain: null })) });
    const bar = await screen.findByTestId('meeting-chain');
    expect(within(bar).getByText(/Next in chain/)).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(within(bar).getByRole('button', { name: 'Remove from chain' }));
    const dialog = screen.getByRole('dialog', { name: 'Take this meeting out of the chain?' });
    expect(dialog).toHaveTextContent('The other meeting won’t be in a chain any more.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove from chain' }));
    await waitFor(() => expect(api.updateMeeting).toHaveBeenCalledWith(id(2), { chain: null }));
    await waitFor(() => expect(screen.queryByTestId('meeting-chain')).toBeNull());
  });

  it('shows a failed removal in the dialog', async () => {
    const m = meeting({ id: id(2), startedAt: at('10:00'), chain: chain([1, 2, 3]) });
    setup(m, [], { updateMeeting: vi.fn(async () => Promise.reject(new Error('Chain is busy'))) });
    fireEvent.click(await screen.findByRole('button', { name: 'Remove from chain' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('The other 2 meetings stay linked.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove from chain' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Chain is busy');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  });

  it('[ ] step through the day and { } through the chain, but not while typing', async () => {
    setup(meeting({ id: id(2), startedAt: at('10:00'), chain: chain([1, 2, 4]) }));
    await screen.findByRole('group', { name: 'Meetings that day' });
    fireEvent.keyDown(document.body, { key: '[' });
    expect(nav.router.push).toHaveBeenLastCalledWith(`/meetings/${id(1)}`);
    fireEvent.keyDown(document.body, { key: ']' });
    expect(nav.router.push).toHaveBeenLastCalledWith(`/meetings/${id(3)}`);
    fireEvent.keyDown(document.body, { key: '}' });
    expect(nav.router.push).toHaveBeenLastCalledWith(`/meetings/${id(4)}`);
    fireEvent.keyDown(document.body, { key: '{' });
    expect(nav.router.push).toHaveBeenLastCalledWith(`/meetings/${id(1)}`);
    expect(nav.router.push).toHaveBeenCalledTimes(4);

    fireEvent.keyDown(screen.getByLabelText('Find in transcript'), { key: ']' });
    fireEvent.keyDown(document.body, { key: ']', metaKey: true });
    fireEvent.keyDown(document.body, { key: 'x' });
    expect(nav.router.push).toHaveBeenCalledTimes(4);
  });

  it('links named speakers to their person page; labels and you to the filtered list', async () => {
    setup(meeting({ id: id(2), startedAt: at('10:00'), speakers: ['Ann', 'Maya Chen', 'Speaker 2'] }), [], { me: vi.fn(async () => ME) });
    const chips = await screen.findByRole('list', { name: 'Speakers and topics' });
    expect(within(chips).getByRole('link', { name: /Maya Chen/ })).toHaveAttribute('href', '/people/Maya%20Chen');
    expect(within(chips).getByRole('link', { name: /Speaker 2/ })).toHaveAttribute('href', '/meetings?speaker=Speaker+2');
    // "You" shows up under the account holder's first name.
    await waitFor(() => expect(within(chips).getByRole('link', { name: /Ann/ })).toHaveAttribute('href', '/meetings?speaker=Ann'));
  });
});
