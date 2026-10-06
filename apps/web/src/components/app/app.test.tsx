import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authValue, fakeApi, meeting, renderWithProviders } from '@/test/utils';
import { AppShell } from './AppShell';
import { ConnectView } from './ConnectView';
import { MeetingsList } from './MeetingsList';
import { MeetingView } from './MeetingView';
import { RequireAuth, signInPath } from './RequireAuth';
import { SettingsView } from './SettingsView';

const nav = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  pathname: '/meetings',
  search: new URLSearchParams(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => nav.router,
  usePathname: () => nav.pathname,
  useSearchParams: () => nav.search,
}));

const ME = { id: '00000000-0000-4000-8000-000000000009', email: 'me@example.com', name: null, emailOnReady: true, createdAt: '2026-10-01T10:00:00.000Z' };
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

beforeEach(() => {
  nav.router.push.mockReset();
  nav.router.replace.mockReset();
  nav.search = new URLSearchParams();
  nav.pathname = '/meetings';
});

describe('RequireAuth', () => {
  it('builds the sign-in path with next', () => {
    expect(signInPath('/connect', '?challenge=abc')).toBe('/signin?next=%2Fconnect%3Fchallenge%3Dabc');
    expect(signInPath('/meetings', '')).toBe('/signin?next=%2Fmeetings');
    expect(signInPath('/x', 'a=1')).toBe('/signin?next=%2Fx%3Fa%3D1');
  });

  it('shows the children to a signed-in user', () => {
    renderWithProviders(<RequireAuth>secret</RequireAuth>);
    expect(screen.getByText('secret')).toBeInTheDocument();
  });

  it('waits while loading, then redirects a signed-out visitor', () => {
    const { rerender } = renderWithProviders(<RequireAuth>secret</RequireAuth>, { auth: authValue({ user: null, loading: true }) });
    expect(screen.getByRole('status')).toHaveTextContent('Checking who you are');
    expect(nav.router.replace).not.toHaveBeenCalled();
    rerender(<RequireAuth>secret</RequireAuth>);
  });

  it('sends a signed-out visitor to sign in with next', () => {
    renderWithProviders(<RequireAuth>secret</RequireAuth>, { auth: authValue({ user: null }) });
    expect(nav.router.replace).toHaveBeenCalledWith('/signin?next=%2Fmeetings');
    expect(screen.queryByText('secret')).toBeNull();
  });

  it('sends someone who just signed out home', () => {
    renderWithProviders(<RequireAuth>secret</RequireAuth>, { auth: authValue({ user: null, signedOutByUser: true }) });
    expect(nav.router.replace).toHaveBeenCalledWith('/');
  });
});

describe('AppShell', () => {
  it('calls GET /me and marks the current section', async () => {
    const me = vi.fn(async () => ME);
    renderWithProviders(<AppShell>body</AppShell>, { auth: authValue({ api: fakeApi({ me }) }) });
    await waitFor(() => expect(me).toHaveBeenCalled());
    expect(screen.getAllByRole('link', { name: 'Meetings' })[0]).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('me@example.com')).toBeInTheDocument();
  });
});

describe('ConnectView', () => {
  it('explains a missing or damaged challenge', () => {
    renderWithProviders(<ConnectView />);
    expect(screen.getByRole('heading', { name: 'This connect link doesn’t work' })).toBeInTheDocument();
    expect(screen.getByText(/missing the security code/)).toBeInTheDocument();
    nav.search = new URLSearchParams('challenge=bad');
    renderWithProviders(<ConnectView />);
    expect(screen.getByText(/damaged/)).toBeInTheDocument();
  });

  it('approves the Mac and hands over to the app', async () => {
    nav.search = new URLSearchParams({ challenge: CHALLENGE, device: 'Studio Mac' });
    const authorizeDevice = vi.fn(async () => ({ code: 'C0DE', expiresInSec: 300, redirectUrl: 'boringtalks://callback?code=C0DE' }));
    const open = vi.fn();
    renderWithProviders(<ConnectView open={open} />, { auth: authValue({ api: fakeApi({ authorizeDevice }) }) });
    expect(screen.getByRole('heading', { name: 'Connect Studio Mac to your BoringTalks account?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Connect this Mac' }));
    await screen.findByRole('heading', { name: 'You can go back to the app.' });
    expect(authorizeDevice).toHaveBeenCalledWith({ codeChallenge: CHALLENGE, deviceName: 'Studio Mac' }, expect.anything());
    expect(open).toHaveBeenCalledWith('boringtalks://callback?code=C0DE');
    expect(screen.getByRole('link', { name: 'Open BoringTalks' })).toHaveAttribute('href', 'boringtalks://callback?code=C0DE');
    expect(screen.getByText('C0DE')).toBeInTheDocument();
    expect(screen.getByText(/expires in 5 minutes/)).toBeInTheDocument();
  });

  it('never redirects anywhere but the app scheme', async () => {
    nav.search = new URLSearchParams({ challenge: CHALLENGE });
    const authorizeDevice = vi.fn(async (_body: unknown) => ({ code: 'X', expiresInSec: 60, redirectUrl: 'https://evil.test/' }));
    const open = vi.fn();
    renderWithProviders(<ConnectView open={open} />, { auth: authValue({ api: fakeApi({ authorizeDevice }) }) });
    fireEvent.click(screen.getByRole('button', { name: 'Connect this Mac' }));
    await screen.findByRole('heading', { name: 'You can go back to the app.' });
    expect(open).not.toHaveBeenCalled();
    expect(screen.queryByRole('link', { name: 'Open BoringTalks' })).toBeNull();
    expect(authorizeDevice.mock.calls[0][0]).toEqual({ codeChallenge: CHALLENGE, deviceName: 'Mac' });
  });

  it('tells the app when the person declines', () => {
    nav.search = new URLSearchParams({ challenge: CHALLENGE });
    const open = vi.fn();
    const authorizeDevice = vi.fn();
    renderWithProviders(<ConnectView open={open} />, { auth: authValue({ api: fakeApi({ authorizeDevice }) }) });
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(open).toHaveBeenCalledWith('boringtalks://callback?error=access_denied');
    expect(screen.getByRole('heading', { name: 'Okay, not connected.' })).toBeInTheDocument();
    expect(authorizeDevice).not.toHaveBeenCalled();
  });

  it('shows API errors', async () => {
    nav.search = new URLSearchParams({ challenge: CHALLENGE });
    const authorizeDevice = vi.fn(async () => Promise.reject(new Error('Code expired')));
    renderWithProviders(<ConnectView open={vi.fn()} />, { auth: authValue({ api: fakeApi({ authorizeDevice }) }) });
    fireEvent.click(screen.getByRole('button', { name: 'Connect this Mac' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Code expired');
  });
});

describe('MeetingsList', () => {
  const page = (items: ReturnType<typeof meeting>[], nextCursor: string | null = null) => ({
    items: items.map((m) => ({ ...m, actionItemCount: m.summary?.actionItems.length ?? 0 })),
    nextCursor,
  });

  it('lists meetings after GET /me, with load more', async () => {
    const me = vi.fn(async () => ME);
    const a = meeting({ id: '00000000-0000-4000-8000-000000000001', source: 'demo' });
    const b = meeting({ id: '00000000-0000-4000-8000-000000000002', title: 'Second', status: 'summarizing', speakers: ['A', 'B', 'C', 'D', 'E', 'F', 'G'] });
    const listMeetings = vi.fn(async ({ cursor }: { cursor?: string }) => (cursor ? page([b]) : page([a], 'next')));
    renderWithProviders(<MeetingsList />, { auth: authValue({ api: fakeApi({ me, listMeetings: listMeetings as never }) }) });
    expect(await screen.findByRole('link', { name: /Pricing review/ })).toHaveAttribute('href', `/meetings/${a.id}`);
    expect(screen.getByText('Demo')).toBeInTheDocument();
    expect(screen.getByText('2 action items')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByRole('heading', { name: 'Second' })).toBeInTheDocument();
    expect(screen.getByText('+1 more')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('shows the empty state, and a no-results state for searches', async () => {
    const listMeetings = vi.fn(async () => page([]));
    renderWithProviders(<MeetingsList />, { auth: authValue({ api: fakeApi({ me: vi.fn(async () => ME), listMeetings }) }) });
    expect(await screen.findByRole('heading', { name: 'No meetings yet' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search meetings'), { target: { value: 'zebra' } });
    expect(await screen.findByText('No meetings matching “zebra”.')).toBeInTheDocument();
    expect(listMeetings).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'zebra' }), expect.anything());
    // The search goes into the URL without adding history entries.
    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith('/meetings?q=zebra', { scroll: false }));
  });

  it('filters by a speaker or topic from the URL and the pills', async () => {
    nav.search = new URLSearchParams('topic=Pricing');
    const a = meeting({ id: '00000000-0000-4000-8000-000000000001', speakers: ['You', 'Maya'], topics: ['Pricing', 'Launch'] });
    const listMeetings = vi.fn(async () => page([a]));
    const meetingFacets = vi.fn(async () => ({ speakers: [{ value: 'Maya', count: 3 }], topics: [{ value: 'Hiring', count: 2 }] }));
    renderWithProviders(<MeetingsList />, { auth: authValue({ api: fakeApi({ me: vi.fn(async () => ME), listMeetings: listMeetings as never, meetingFacets }) }) });
    await screen.findByRole('link', { name: /Pricing review/ });
    expect(listMeetings).toHaveBeenCalledWith(expect.objectContaining({ topic: 'Pricing' }), expect.anything());

    // The filter bar offers frequent people and topics, and keeps the active one visible.
    const filters = screen.getByRole('group', { name: 'Filters' });
    expect(within(within(filters).getByRole('list', { name: 'Topics' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['#Pricing', '#Hiring']);

    // A pill in a row narrows the list further; the active one toggles off.
    const row = screen.getByRole('list', { name: 'Speakers and topics' });
    fireEvent.click(within(row).getByRole('button', { name: /Maya/ }));
    expect(nav.router.push).toHaveBeenLastCalledWith('/meetings?speaker=Maya&topic=Pricing', { scroll: false });
    const active = within(row).getByRole('button', { name: /Pricing/ });
    expect(active).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(active);
    expect(nav.router.push).toHaveBeenLastCalledWith('/meetings', { scroll: false });

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(nav.router.push).toHaveBeenLastCalledWith('/meetings', { scroll: false });
  });

  it('says what was filtered when nothing matches', async () => {
    nav.search = new URLSearchParams('speaker=Maya&topic=Hiring');
    renderWithProviders(<MeetingsList />, { auth: authValue({ api: fakeApi({ me: vi.fn(async () => ME), listMeetings: vi.fn(async () => page([])) }) }) });
    expect(await screen.findByText('No meetings with Maya about Hiring.')).toBeInTheDocument();
  });

  it('shows errors with a retry', async () => {
    renderWithProviders(<MeetingsList />, { auth: authValue({ api: fakeApi({ me: vi.fn(async () => Promise.reject(new Error('API asleep'))) }) }) });
    expect(await screen.findByRole('alert')).toHaveTextContent('API asleep');
  });
});

describe('MeetingView', () => {
  function setup(m = meeting(), extra: Parameters<typeof fakeApi>[0] = {}) {
    const api = fakeApi({ getMeeting: vi.fn(async () => m), updateMeeting: vi.fn(async (_id, body) => ({ ...m, ...('title' in body ? { title: body.title } : {}) })), ...extra });
    renderWithProviders(<MeetingView id={m.id} />, { auth: authValue({ api }) });
    return api;
  }

  it('shows the summary, topics, action items, decisions and merged transcript', async () => {
    setup();
    expect(await screen.findByRole('heading', { level: 1, name: 'Pricing review: Pro to $29, launch Nov 3' })).toBeInTheDocument();
    expect(screen.getByText('We raised the price.')).toBeInTheDocument();
    expect(screen.getByText('Annual stays.')).toBeInTheDocument();
    expect(screen.getByText('Launch')).toBeInTheDocument();
    expect(screen.getByText('1 of 2 done')).toBeInTheDocument();
    expect(screen.getByText('Pro is $29')).toBeInTheDocument();
    const transcript = screen.getByTestId('transcript');
    // The two opening "You" phrases are one turn.
    expect(within(transcript).getAllByRole('listitem')).toHaveLength(3);
    expect(within(transcript).getByText('Okay, pricing. Pro goes to 29.')).toBeInTheDocument();
  });

  it('scrolls to and flashes the action item a task link points at, with its due date', async () => {
    window.location.hash = '#task-a1';
    setup();
    const row = await screen.findByText('Write the launch email');
    const li = row.closest('li')!;
    await waitFor(() => expect(li).toHaveAttribute('data-highlight', 'true'));
    expect(li).toHaveAttribute('id', 'task-a1');
    expect(within(li).getByText(/Due Oct 30/)).toHaveTextContent('Due Oct 30 · Fri, Oct 30');
    window.location.hash = '';
  });

  it('toggles an action item with a PATCH', async () => {
    const api = setup();
    fireEvent.click(await screen.findByRole('checkbox', { name: /Write the launch email/ }));
    await waitFor(() => expect(api.updateMeeting).toHaveBeenCalledWith(expect.any(String), { actionItem: { id: 'a1', done: true } }));
  });

  it('seeks the audio from the transcript and highlights the segment', async () => {
    setup();
    const btn = await screen.findByRole('button', { name: 'Play from 0:07: Speaker 1' });
    fireEvent.click(btn);
    const audio = screen.getByTestId('meeting-audio') as HTMLAudioElement;
    expect(audio.currentTime).toBe(7);
    await waitFor(() => expect(btn.closest('li')).toHaveAttribute('data-active', 'true'));
  });

  it('links speakers and topics to the filtered list, and renames speakers', async () => {
    const m = meeting({ speakers: ['You', 'Speaker 1'], topics: ['Pricing'] });
    const api = setup(m, { updateMeeting: vi.fn(async () => ({ ...m, speakers: ['You', 'Maya'] })) });
    const chips = await screen.findByRole('list', { name: 'Speakers and topics' });
    expect(within(chips).getByRole('link', { name: /Speaker 1/ })).toHaveAttribute('href', '/meetings?speaker=Speaker+1');
    expect(within(chips).getByRole('link', { name: /Pricing/ })).toHaveAttribute('href', '/meetings?topic=Pricing');

    fireEvent.click(within(chips).getByRole('button', { name: 'Rename speakers' }));
    const form = screen.getByRole('form', { name: 'Rename speakers' });
    fireEvent.change(within(form).getByLabelText('Speaker 1'), { target: { value: ' Maya ' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save names' }));
    // Only the changed name is sent, trimmed.
    await waitFor(() => expect(api.updateMeeting).toHaveBeenCalledWith(m.id, { speakers: { 'Speaker 1': 'Maya' } }));
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Rename speakers' })).toBeNull());

    // Nothing changed: just closes.
    fireEvent.click(screen.getByRole('button', { name: 'Rename speakers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save names' }));
    expect(screen.queryByRole('form', { name: 'Rename speakers' })).toBeNull();
    expect(api.updateMeeting).toHaveBeenCalledTimes(1);
  });

  it('renames inline', async () => {
    const api = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Rename meeting' }));
    const input = screen.getByLabelText('Meeting title');
    fireEvent.change(input, { target: { value: 'Pricing, done' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(api.updateMeeting).toHaveBeenCalledWith(expect.any(String), { title: 'Pricing, done' }));
  });

  it('Escape cancels a rename', async () => {
    const api = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Rename meeting' }));
    fireEvent.keyDown(screen.getByLabelText('Meeting title'), { key: 'Escape' });
    expect(screen.queryByLabelText('Meeting title')).toBeNull();
    expect(api.updateMeeting).not.toHaveBeenCalled();
  });

  it('copies the summary as Markdown', async () => {
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Copy summary as Markdown' }));
    await screen.findByRole('button', { name: 'Copied' });
    expect(writeText.mock.calls[0][0]).toMatch(/^# Pricing review/);
  });

  it('deletes after confirming in the dialog', async () => {
    const api = setup(meeting(), { deleteMeeting: vi.fn(async () => undefined) });
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete meeting' }));
    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith('/meetings'));
    expect(api.deleteMeeting).toHaveBeenCalled();
  });

  it('shows a waiting head while processing', async () => {
    setup(meeting({ status: 'transcribing', summary: null, segments: [], audioUrl: null }));
    expect(await screen.findByTestId('processing-banner')).toHaveTextContent('Listening to the whole thing');
    expect(screen.getByText('The transcript shows up here once it’s ready.')).toBeInTheDocument();
    expect(screen.getByText('No audio was kept for this meeting, only the text.')).toBeInTheDocument();
  });

  it('offers Reprocess when it failed', async () => {
    const api = setup(meeting({ status: 'failed', error: 'The summarizer timed out.', summary: null }), {
      reprocessMeeting: vi.fn(async () => meeting({ status: 'transcribing', summary: null })),
    });
    expect(await screen.findByText('The summarizer timed out.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reprocess' }));
    await waitFor(() => expect(api.reprocessMeeting).toHaveBeenCalled());
  });

  it('says when a meeting does not exist', async () => {
    const { ApiRequestError } = await import('@/lib/api');
    const api = fakeApi({ getMeeting: vi.fn(async () => Promise.reject(new ApiRequestError('Not found', 404))) });
    renderWithProviders(<MeetingView id="nope" />, { auth: authValue({ api }) });
    expect(await screen.findByRole('heading', { name: 'This meeting isn’t here' })).toBeInTheDocument();
  });
});

describe('SettingsView', () => {
  it('toggles email, revokes a Mac and signs out', async () => {
    const device = { id: '00000000-0000-4000-8000-0000000000d1', name: 'Studio Mac', createdAt: '2026-10-01T10:00:00.000Z', lastSeenAt: null };
    const api = fakeApi({
      me: vi.fn(async () => ME),
      updateSettings: vi.fn(async (b) => ({ ...ME, ...b })),
      listDevices: vi.fn().mockResolvedValueOnce([device]).mockResolvedValue([]),
      revokeDevice: vi.fn(async () => undefined),
      latestDownload: vi.fn(),
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
    const auth = authValue({ api });
    renderWithProviders(<SettingsView />, { auth });
    expect(screen.getByText('me@example.com')).toBeInTheDocument();

    const sw = await screen.findByRole('switch', { name: 'Email me when a meeting is ready' });
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'true'));
    fireEvent.click(sw);
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith({ emailOnReady: false }, expect.anything()));

    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
    const dialog = screen.getByRole('dialog', { name: 'Disconnect Studio Mac?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(api.revokeDevice).toHaveBeenCalledWith('00000000-0000-4000-8000-0000000000d1'));
    expect(await screen.findByText(/No Macs connected yet/)).toBeInTheDocument();

    // Your name: saved trimmed, and the button settles on "Saved".
    const name = screen.getByLabelText(/What should meetings call you/);
    fireEvent.change(name, { target: { value: ' Maya Chen ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith({ name: 'Maya Chen' }, expect.anything()));
    expect(await screen.findByRole('button', { name: 'Saved' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(auth.signOut).toHaveBeenCalled());
    vi.unstubAllGlobals();
  });
});
