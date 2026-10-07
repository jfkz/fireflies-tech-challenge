import type { MeetingDetail, MeetingPage } from '@boringtalks/shared';
import { act, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authValue, fakeApi, meeting, renderHookWithProviders } from '@/test/utils';
import {
  applyUpdate,
  keys,
  useDeleteMeeting,
  useDevices,
  useLatestDownload,
  useMe,
  useMeeting,
  useMeetings,
  usePeople,
  usePerson,
  useRenamePerson,
  useRevokeDevice,
  useSameDayMeetings,
  useUpdateMeeting,
  useUpdateSettings,
} from './queries';

afterEach(() => vi.useRealTimers());

const item = (m: MeetingDetail) => ({
  id: m.id,
  title: m.title,
  description: m.description,
  status: m.status,
  source: m.source,
  startedAt: m.startedAt,
  durationSec: m.durationSec,
  speakers: m.speakers,
  topics: m.topics,
  actionItemCount: 2,
  hasAudio: m.hasAudio,
});

describe('useMeeting polling', () => {
  it('polls every 3 s while processing and stops once ready', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const statuses = ['transcribing', 'summarizing', 'ready', 'ready'] as const;
    let n = 0;
    const getMeeting = vi.fn(async () => meeting({ status: statuses[Math.min(n++, statuses.length - 1)] }));
    const { result } = renderHookWithProviders(() => useMeeting('m1'), { auth: authValue({ api: fakeApi({ getMeeting }) }) });
    await waitFor(() => expect(result.current.data?.status).toBe('transcribing'));
    await act(() => vi.advanceTimersByTimeAsync(3000));
    await waitFor(() => expect(result.current.data?.status).toBe('summarizing'));
    await act(() => vi.advanceTimersByTimeAsync(3000));
    await waitFor(() => expect(result.current.data?.status).toBe('ready'));
    const calls = getMeeting.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(getMeeting.mock.calls.length).toBe(calls);
  });

  it('stops polling on failed too', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const getMeeting = vi.fn(async () => meeting({ status: 'failed', error: 'LLM timeout' }));
    const { result } = renderHookWithProviders(() => useMeeting('m1'), { auth: authValue({ api: fakeApi({ getMeeting }) }) });
    await waitFor(() => expect(result.current.data?.status).toBe('failed'));
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(getMeeting).toHaveBeenCalledTimes(1);
  });

  it('waits for a signed-in user', () => {
    const getMeeting = vi.fn();
    renderHookWithProviders(() => useMeeting('m1'), { auth: authValue({ user: null, api: fakeApi({ getMeeting }) }) });
    expect(getMeeting).not.toHaveBeenCalled();
  });
});

describe('useMeetings', () => {
  it('pages with the cursor and passes q', async () => {
    const a = meeting({ id: '00000000-0000-4000-8000-000000000001' });
    const b = meeting({ id: '00000000-0000-4000-8000-000000000002' });
    const listMeetings = vi.fn(async ({ cursor }: { cursor?: string }): Promise<MeetingPage> => (cursor ? { items: [item(b)], nextCursor: null } : { items: [item(a)], nextCursor: 'c2' }));
    const { result } = renderHookWithProviders(() => useMeetings({ q: 'pricing' }), { auth: authValue({ api: fakeApi({ listMeetings: listMeetings as never }) }) });
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(1));
    expect(listMeetings).toHaveBeenCalledWith({ cursor: undefined, q: 'pricing', limit: 20 }, expect.any(AbortSignal));
    expect(result.current.hasNextPage).toBe(true);
    await act(() => result.current.fetchNextPage());
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
    expect(listMeetings.mock.calls[1][0]).toEqual({ cursor: 'c2', q: 'pricing', limit: 20 });
    expect(result.current.hasNextPage).toBe(false);
  });

  it('does not list until GET /me is done', () => {
    const listMeetings = vi.fn();
    renderHookWithProviders(() => useMeetings({}, false), { auth: authValue({ api: fakeApi({ listMeetings }) }) });
    expect(listMeetings).not.toHaveBeenCalled();
  });

  it('refreshes the list while something is processing', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const listMeetings = vi.fn(async () => ({ items: [item(meeting({ status: 'summarizing' }))], nextCursor: null }));
    const { result } = renderHookWithProviders(() => useMeetings({ q: '' }), { auth: authValue({ api: fakeApi({ listMeetings }) }) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await act(() => vi.advanceTimersByTimeAsync(5000));
    await waitFor(() => expect(listMeetings.mock.calls.length).toBeGreaterThan(1));
  });
});

describe('mutations', () => {
  it('applyUpdate renames and toggles items', () => {
    const m = meeting();
    expect(applyUpdate(m, { title: 'New' }).title).toBe('New');
    const toggled = applyUpdate(m, { actionItem: { id: 'a1', done: true } });
    expect(toggled.summary!.actionItems.map((a) => a.done)).toEqual([true, true]);
    expect(applyUpdate(meeting({ summary: null }), { actionItem: { id: 'a1', done: true } }).summary).toBeNull();
  });

  it('toggles optimistically and rolls back on error', async () => {
    const m = meeting();
    let reject!: (e: Error) => void;
    const updateMeeting = vi.fn(() => new Promise<MeetingDetail>((_, r) => (reject = r)));
    const auth = authValue({ api: fakeApi({ updateMeeting }) });
    const { result, client } = renderHookWithProviders(() => useUpdateMeeting(m.id), { auth });
    client.setQueryData(keys.meeting('u1', m.id), m);
    act(() => result.current.mutate({ actionItem: { id: 'a1', done: true } }));
    await waitFor(() => expect(client.getQueryData<MeetingDetail>(keys.meeting('u1', m.id))!.summary!.actionItems[0].done).toBe(true));
    await act(async () => reject(new Error('nope')));
    await waitFor(() => expect(client.getQueryData<MeetingDetail>(keys.meeting('u1', m.id))!.summary!.actionItems[0].done).toBe(false));
  });

  it('stores the server answer after a successful update', async () => {
    const m = meeting();
    const updateMeeting = vi.fn(async () => ({ ...m, title: 'Server title' }));
    const { result, client } = renderHookWithProviders(() => useUpdateMeeting(m.id), { auth: authValue({ api: fakeApi({ updateMeeting }) }) });
    client.setQueryData(keys.meeting('u1', m.id), m);
    await act(() => result.current.mutateAsync({ title: 'Mine' }));
    expect(client.getQueryData<MeetingDetail>(keys.meeting('u1', m.id))!.title).toBe('Server title');
  });

  it('removes a deleted meeting from cached lists', async () => {
    const m = meeting();
    const deleteMeeting = vi.fn(async () => undefined);
    const { result, client } = renderHookWithProviders(() => useDeleteMeeting(), { auth: authValue({ api: fakeApi({ deleteMeeting }) }) });
    client.setQueryData(keys.meetings('u1', {}), { pages: [{ items: [item(m)], nextCursor: null }], pageParams: [undefined] });
    // The facets live under the same prefix and must survive the list update.
    client.setQueryData(keys.facets('u1'), { speakers: [], topics: [] });
    await act(() => result.current.mutateAsync(m.id));
    expect(client.getQueryData<{ pages: MeetingPage[] }>(keys.meetings('u1', {}))!.pages[0].items).toEqual([]);
  });

  it('me, settings, devices and revoke', async () => {
    const me = { id: '00000000-0000-4000-8000-000000000009', email: 'a@b.co', name: null, emailOnReady: true, createdAt: '2026-10-01T10:00:00.000Z' };
    const api = fakeApi({
      me: vi.fn(async () => me),
      updateSettings: vi.fn(async (b) => ({ ...me, ...b })),
      listDevices: vi.fn(async () => []),
      revokeDevice: vi.fn(async () => undefined),
    });
    const auth = authValue({ api });
    const { result, client } = renderHookWithProviders(() => ({ me: useMe(), settings: useUpdateSettings(), devices: useDevices(), revoke: useRevokeDevice() }), { auth });
    await waitFor(() => expect(result.current.me.data).toEqual(me));
    await act(() => result.current.settings.mutateAsync({ emailOnReady: false }));
    expect(client.getQueryData<typeof me>(keys.me('u1'))!.emailOnReady).toBe(false);
    await waitFor(() => expect(result.current.devices.data).toEqual([]));
    await act(() => result.current.revoke.mutateAsync('d1'));
    expect(api.revokeDevice).toHaveBeenCalledWith('d1');
  });
});

describe('people and navigation', () => {
  const maya = { name: 'Maya', meetingCount: 1, togetherSec: 1800, talkSec: 600, lastMetAt: '2026-10-01T10:00:00.000Z', openTasks: 0, meetings: [], topics: [], tasks: [] };

  it('lists people for a period and all time', async () => {
    const listPeople = vi.fn(async () => ({ since: null, meetingSec: 0, people: [] }));
    const auth = authValue({ api: fakeApi({ listPeople }) });
    renderHookWithProviders(() => [usePeople(30), usePeople(null)], { auth });
    await waitFor(() => expect(listPeople).toHaveBeenCalledTimes(2));
    expect(listPeople.mock.calls.map((c: unknown[]) => c[0])).toEqual([30, undefined]);
  });

  it('renames a person: the new name is cached, the old one dropped, the rest refreshed', async () => {
    const getPerson = vi.fn(async () => ({ ...maya, name: 'Maya Chen' }));
    const renamePerson = vi.fn(async () => maya);
    const { result, client } = renderHookWithProviders(() => ({ person: usePerson('Maya Chen'), rename: useRenamePerson() }), {
      auth: authValue({ api: fakeApi({ getPerson, renamePerson }) }),
    });
    await waitFor(() => expect(result.current.person.data?.name).toBe('Maya Chen'));
    client.setQueryData(keys.people('u1', 30), { since: null, meetingSec: 0, people: [] });
    await act(() => result.current.rename.mutateAsync({ name: 'Maya Chen', newName: 'Maya' }));
    expect(renamePerson).toHaveBeenCalledWith('Maya Chen', 'Maya');
    expect(client.getQueryData(keys.person('u1', 'maya'))).toEqual(maya);
    expect(client.getQueryState(keys.people('u1', 30))!.isInvalidated).toBe(true);
  });

  it('lists the meetings of the local day a meeting started on', async () => {
    const listMeetings = vi.fn(async () => ({ items: [item(meeting())], nextCursor: null }));
    const { result } = renderHookWithProviders(() => useSameDayMeetings('2026-10-06T15:00:00.000Z'), { auth: authValue({ api: fakeApi({ listMeetings: listMeetings as never }) }) });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    const start = new Date('2026-10-06T15:00:00.000Z');
    start.setHours(0, 0, 0, 0);
    expect(listMeetings).toHaveBeenCalledWith(expect.objectContaining({ from: start.toISOString(), limit: 100 }), expect.anything());
  });

  it('a chain change refreshes the other meetings of the chain', async () => {
    const m = meeting();
    const updateMeeting = vi.fn(async () => ({ ...m, chain: null }));
    const { result, client } = renderHookWithProviders(() => useUpdateMeeting(m.id), { auth: authValue({ api: fakeApi({ updateMeeting }) }) });
    client.setQueryData(keys.meeting('u1', m.id), m);
    client.setQueryData(keys.meeting('u1', 'other'), m);
    await act(() => result.current.mutateAsync({ chain: null }));
    expect(updateMeeting).toHaveBeenCalledWith(m.id, { chain: null });
    expect(client.getQueryState(keys.meeting('u1', 'other'))!.isInvalidated).toBe(true);
    expect(client.getQueryState(keys.meeting('u1', m.id))!.isInvalidated).toBe(false);
  });
});

describe('useLatestDownload', () => {
  it('reads the public endpoint without a token', async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL) => new Response(JSON.stringify({ statusCode: 404, message: 'none' }), { status: 404 }));
    vi.stubGlobal('fetch', fetch);
    const { result } = renderHookWithProviders(() => useLatestDownload(), { auth: authValue({ user: null }) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
    expect(String(fetch.mock.calls[0][0])).toMatch(/\/downloads\/latest$/);
    vi.unstubAllGlobals();
  });
});
