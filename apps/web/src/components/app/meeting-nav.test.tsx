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

  describe('Link to…', () => {
    const item = (n: number, title: string, day: string) => ({ ...meeting({ id: id(n), title, startedAt: `2026-${day}T10:00:00.000Z` }), actionItemCount: 0 });
    const KICKOFF = item(5, 'Pricing kickoff', '09-20');
    const FOLLOW_UP = item(6, 'Pricing follow-up', '10-03');
    const OLD = item(7, 'Pricing in spring', '04-01');
    const CHAINED = item(4, 'Pricing 4', '09-24');

    /** The day query gets nothing; the picker gets the meetings around this one, or OLD for a search. */
    function linkApi(m: MeetingDetail, updateMeeting = vi.fn(async () => ({ ...m, chain: chain([2, 5]) }))) {
      const listMeetings = vi.fn(async (q: { q?: string; from?: string; to?: string }) => {
        if (q.q) return { items: q.q === 'spring' ? [OLD] : [], nextCursor: null };
        const days = (Date.parse(q.to!) - Date.parse(q.from!)) / 86_400_000;
        return { items: days > 2 ? [FOLLOW_UP, CHAINED, { ...m, actionItemCount: 0 }, KICKOFF] : [], nextCursor: null };
      });
      return setup(m, [], { listMeetings: listMeetings as never, updateMeeting: updateMeeting as never });
    }

    it('links a meeting that is in no chain to another one, nearest first or searched', async () => {
      const m = meeting({ id: id(2), startedAt: '2026-10-01T10:00:00.000Z' });
      const api = linkApi(m);
      fireEvent.click(await screen.findByRole('button', { name: 'Link to…' }));
      const dialog = screen.getByRole('dialog', { name: 'Link to another meeting' });
      expect(dialog).not.toHaveTextContent('leaves its current chain');
      const list = await within(dialog).findByRole('list', { name: 'Meetings to link to' });
      // Nearest first, without the meeting itself.
      expect(within(list).getAllByRole('button').map((b) => b.textContent)).toEqual([
        expect.stringContaining('Pricing follow-up'),
        expect.stringContaining('Pricing 4'),
        expect.stringContaining('Pricing kickoff'),
      ]);
      expect(api.listMeetings).toHaveBeenCalledWith(
        { from: '2026-08-17T10:00:00.000Z', to: '2026-11-15T10:00:00.000Z', limit: 100 },
        expect.anything(),
      );

      const search = within(dialog).getByRole('searchbox', { name: 'Search meetings' });
      fireEvent.change(search, { target: { value: 'nothing' } });
      expect(await within(dialog).findByText('No other meetings match “nothing”.')).toBeInTheDocument();
      fireEvent.change(search, { target: { value: ' spring ' } });
      fireEvent.click(await within(dialog).findByRole('button', { name: /Pricing in spring/ }));
      expect(api.listMeetings).toHaveBeenCalledWith({ q: 'spring', limit: 30 }, expect.anything());
      await waitFor(() => expect(api.updateMeeting).toHaveBeenCalledWith(id(2), { chain: { with: id(7) } }));
      // Linked: the picker closes and the chain shows.
      expect(await screen.findByTestId('meeting-chain')).toHaveTextContent('Chain · 1 of 2');
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it("hides the chain's own meetings and says this one leaves it", async () => {
      linkApi(meeting({ id: id(2), startedAt: '2026-10-01T10:00:00.000Z', chain: chain([2, 4]) }));
      fireEvent.click(await screen.findByRole('button', { name: 'Link to…' }));
      const dialog = screen.getByRole('dialog', { name: 'Link to another meeting' });
      expect(dialog).toHaveTextContent('This meeting leaves its current chain.');
      const list = await within(dialog).findByRole('list', { name: 'Meetings to link to' });
      expect(within(list).getAllByRole('button').map((b) => b.textContent)).toEqual([expect.stringContaining('Pricing follow-up'), expect.stringContaining('Pricing kickoff')]);
    });

    it('says when there is nothing nearby, and closes with Escape or Cancel', async () => {
      setup(meeting({ id: id(2), startedAt: at('10:00') }), []);
      fireEvent.click(await screen.findByRole('button', { name: 'Link to…' }));
      let dialog = screen.getByRole('dialog', { name: 'Link to another meeting' });
      expect(await within(dialog).findByText('No other meetings within 45 days. Search to find older ones.')).toBeInTheDocument();
      fireEvent.keyDown(within(dialog).getByRole('searchbox'), { key: 'Escape' });
      expect(screen.queryByRole('dialog')).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Link to…' }));
      dialog = screen.getByRole('dialog', { name: 'Link to another meeting' });
      // The search starts empty again.
      expect(within(dialog).getByRole('searchbox')).toHaveValue('');
      fireEvent.keyDown(dialog, { key: 'Enter' });
      fireEvent(dialog, new Event('cancel'));
      expect(screen.queryByRole('dialog')).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Link to…' }));
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Link to…' }));
      // A click on the backdrop lands on the dialog itself.
      fireEvent.click(screen.getByRole('dialog'));
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('shows a failed link in the picker', async () => {
      const m = meeting({ id: id(2), startedAt: '2026-10-01T10:00:00.000Z' });
      linkApi(m, vi.fn(async () => Promise.reject(new Error('Chain is busy'))));
      fireEvent.click(await screen.findByRole('button', { name: 'Link to…' }));
      const dialog = screen.getByRole('dialog');
      fireEvent.click(await within(dialog).findByRole('button', { name: /Pricing kickoff/ }));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('Chain is busy');
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('shows a list that would not load', async () => {
      setup(meeting({ id: id(2), startedAt: at('10:00') }), [], { listMeetings: vi.fn(async () => Promise.reject(new Error('API asleep'))) });
      fireEvent.click(await screen.findByRole('button', { name: 'Link to…' }));
      expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('API asleep');
    });
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
