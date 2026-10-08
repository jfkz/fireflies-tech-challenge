'use client';

import type { ListTasksQuery, MeetingDetail, MeetingPage, MeetingStatsQuery, PersonDetail, TaskItem, TaskPage, UpdateMeetingRequest } from '@boringtalks/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { publicApi, useAuth } from '@/components/providers/AuthProvider';
import { aroundRange, LINK_WINDOW_DAYS, localDayRange } from '@/lib/meeting-nav';
import { isProcessing, meetingPollInterval } from '@/lib/status';

/** Query keys, scoped by user so two accounts never share a cache entry. */
export const keys = {
  me: (uid: string | undefined) => ['me', uid] as const,
  meetings: (uid: string | undefined, filters: MeetingFilters) => ['meetings', uid, 'list', filters] as const,
  /** Every filtered list (the infinite queries). */
  meetingLists: (uid: string | undefined) => ['meetings', uid, 'list'] as const,
  facets: (uid: string | undefined) => ['meetings', uid, 'facets'] as const,
  stats: (uid: string | undefined, q: MeetingStatsQuery) => ['meetings', uid, 'stats', q] as const,
  tasks: (uid: string | undefined, status: TaskStatus, owner?: string) => ['tasks', uid, status, owner ?? null] as const,
  allTasks: (uid: string | undefined) => ['tasks', uid] as const,
  /** Lists and facets together: what changes when a meeting does. */
  allMeetings: (uid: string | undefined) => ['meetings', uid] as const,
  meeting: (uid: string | undefined, id: string) => ['meeting', uid, id] as const,
  /** Every meeting page (a chain change shows on all of its meetings). */
  allMeetingDetails: (uid: string | undefined) => ['meeting', uid] as const,
  /** The meetings of one local day, for "previous / next today"; under `allMeetings`, so it refreshes with them. */
  day: (uid: string | undefined, from: string) => ['meetings', uid, 'day', from] as const,
  /** What the "Link to…" picker offers: a search, or the meetings around one; under `allMeetings` too. */
  linkCandidates: (uid: string | undefined, around: string, q: string) => ['meetings', uid, 'link', around, q] as const,
  people: (uid: string | undefined, days: number | null) => ['people', uid, days] as const,
  allPeople: (uid: string | undefined) => ['people', uid] as const,
  /** By lower-cased name: the API matches names in any case. */
  person: (uid: string | undefined, name: string) => ['person', uid, name.toLocaleLowerCase()] as const,
  allPersons: (uid: string | undefined) => ['person', uid] as const,
  devices: (uid: string | undefined) => ['devices', uid] as const,
  latestDownload: ['latest-download'] as const,
};

export function useMe() {
  const { api, user } = useAuth();
  return useQuery({ queryKey: keys.me(user?.uid), queryFn: () => api.me(), enabled: !!user });
}

export function useUpdateSettings() {
  const { api, user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.updateSettings,
    onSuccess: (me, body) => {
      qc.setQueryData(keys.me(user?.uid), me);
      // A new name renames "You" in past meetings on the server.
      if (body.name !== undefined) {
        void qc.invalidateQueries({ queryKey: keys.allMeetings(user?.uid) });
        void qc.invalidateQueries({ queryKey: ['meeting', user?.uid] });
      }
    },
  });
}

type TaskStatus = ListTasksQuery['status'];

/** Action items from every meeting, soonest due first (open ones by default). */
export function useTasks(status: TaskStatus = 'open', owner?: string, enabled = true) {
  const { api, user } = useAuth();
  return useInfiniteQuery({
    queryKey: keys.tasks(user?.uid, status, owner),
    queryFn: ({ pageParam, signal }) => api.listTasks({ status, owner, cursor: pageParam, limit: 100 }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: TaskPage) => last.nextCursor ?? undefined,
    enabled: !!user && enabled,
  });
}

/** Ticks a task off (or back on) through its meeting; the task moves between lists right away. */
export function useToggleTask() {
  const { api, user } = useAuth();
  const qc = useQueryClient();
  const setDone = (id: string, meetingId: string, done: boolean) => {
    const tick = (t: TaskItem) => (t.id === id && t.meeting.id === meetingId ? { ...t, done } : t);
    qc.setQueriesData<InfiniteData<TaskPage>>({ queryKey: keys.allTasks(user?.uid) }, (data) =>
      data ? { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.map(tick) })) } : data,
    );
    // A person page lists their tasks too.
    qc.setQueriesData<PersonDetail>({ queryKey: keys.allPersons(user?.uid) }, (p) => (p ? { ...p, tasks: p.tasks.map(tick) } : p));
  };
  return useMutation({
    mutationFn: (t: Pick<TaskItem, 'id' | 'meeting'> & { done: boolean }) => api.updateMeeting(t.meeting.id, { actionItem: { id: t.id, done: t.done } }),
    onMutate: async (t) => {
      await qc.cancelQueries({ queryKey: keys.allTasks(user?.uid) });
      setDone(t.id, t.meeting.id, t.done);
    },
    onError: (_e, t) => setDone(t.id, t.meeting.id, !t.done),
    onSuccess: (m) => qc.setQueryData(keys.meeting(user?.uid, m.id), m),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.allPeople(user?.uid) });
      void qc.invalidateQueries({ queryKey: keys.allPersons(user?.uid) });
      return qc.invalidateQueries({ queryKey: keys.allTasks(user?.uid) });
    },
  });
}

/** Meetings and minutes per day, for the calendar. */
export function useMeetingStats(q: MeetingStatsQuery) {
  const { api, user } = useAuth();
  return useQuery({ queryKey: keys.stats(user?.uid, q), queryFn: ({ signal }) => api.meetingStats(q, signal), enabled: !!user });
}

/** What the meeting list is narrowed to: search text, a person, a topic, a time range (ISO). */
export interface MeetingFilters {
  q?: string;
  speaker?: string;
  topic?: string;
  from?: string;
  to?: string;
}

/** Cursor-paginated meeting list. `ready` lets the caller wait for GET /me (which creates the account). */
export function useMeetings(filters: MeetingFilters, ready = true) {
  const { api, user } = useAuth();
  const clean = Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) as MeetingFilters;
  return useInfiniteQuery({
    queryKey: keys.meetings(user?.uid, clean),
    queryFn: ({ pageParam, signal }) => api.listMeetings({ cursor: pageParam, limit: 20, ...clean }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: MeetingPage) => last.nextCursor ?? undefined,
    enabled: !!user && ready,
    // Keep the status chips moving while anything in the list is still being processed.
    refetchInterval: (query) =>
      query.state.data?.pages.some((p) => p.items.some((m) => isProcessing(m.status))) ? 5000 : false,
  });
}

/** The speakers and topics to offer as filters. */
export function useMeetingFacets(ready = true) {
  const { api, user } = useAuth();
  return useQuery({ queryKey: keys.facets(user?.uid), queryFn: ({ signal }) => api.meetingFacets(signal), enabled: !!user && ready });
}

export function useMeeting(id: string) {
  const { api, user } = useAuth();
  return useQuery({
    queryKey: keys.meeting(user?.uid, id),
    queryFn: ({ signal }) => api.getMeeting(id, signal),
    enabled: !!user && !!id,
    refetchInterval: (query) => meetingPollInterval(query.state.data?.status),
  });
}

function useSetMeeting() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return (m: MeetingDetail) => {
    qc.setQueryData(keys.meeting(user?.uid, m.id), m);
    void qc.invalidateQueries({ queryKey: keys.allMeetings(user?.uid) });
    void qc.invalidateQueries({ queryKey: keys.allTasks(user?.uid) });
    // Names, talk time and open tasks on the people pages come from meetings.
    void qc.invalidateQueries({ queryKey: keys.allPeople(user?.uid) });
    void qc.invalidateQueries({ queryKey: keys.allPersons(user?.uid) });
  };
}

export function useUpdateMeeting(id: string) {
  const { api, user } = useAuth();
  const qc = useQueryClient();
  const setMeeting = useSetMeeting();
  const key = keys.meeting(user?.uid, id);
  return useMutation({
    mutationFn: (body: UpdateMeetingRequest) => api.updateMeeting(id, body),
    // Optimistic: the checkbox / title change shows at once and rolls back on error.
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<MeetingDetail>(key);
      if (previous) qc.setQueryData(key, applyUpdate(previous, body));
      return { previous };
    },
    onError: (_err, _body, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    onSuccess: (m, body) => {
      setMeeting(m);
      // The other meetings of the chain list this one too.
      if (body.chain !== undefined) void qc.invalidateQueries({ queryKey: keys.allMeetingDetails(user?.uid), predicate: (q) => q.queryKey[2] !== m.id });
    },
  });
}

/** What a PATCH will do, applied locally. */
export function applyUpdate(m: MeetingDetail, body: UpdateMeetingRequest): MeetingDetail {
  let next = m;
  if (body.title !== undefined) next = { ...next, title: body.title };
  const renames = body.speakers;
  if (renames) {
    const rename = (s: string) => (Object.hasOwn(renames, s) ? renames[s] : s);
    next = {
      ...next,
      speakers: [...new Set(next.speakers.map(rename))],
      segments: next.segments.map((s) => ({ ...s, speaker: rename(s.speaker) })),
      summary: next.summary && { ...next.summary, actionItems: next.summary.actionItems.map((a) => ({ ...a, owner: a.owner && rename(a.owner) })) },
    };
  }
  const item = body.actionItem;
  if (item && next.summary) {
    next = {
      ...next,
      summary: { ...next.summary, actionItems: next.summary.actionItems.map((a) => (a.id === item.id ? { ...a, done: item.done } : a)) },
    };
  }
  return next;
}

/** The meetings on the same local day as `startedAt`, for stepping through a day. */
export function useSameDayMeetings(startedAt: string) {
  const { api, user } = useAuth();
  const { from, to } = localDayRange(startedAt);
  return useQuery({
    queryKey: keys.day(user?.uid, from),
    queryFn: ({ signal }) => api.listMeetings({ from, to, limit: 100 }, signal),
    enabled: !!user,
    select: (page) => page.items,
  });
}

/**
 * Meetings to link one into a chain with: those matching `q` across everything, or with no search the
 * ones within LINK_WINDOW_DAYS of `startedAt`. Only fetched while the picker is open (`enabled`).
 */
export function useLinkCandidates(startedAt: string, q: string, enabled: boolean) {
  const { api, user } = useAuth();
  return useQuery({
    queryKey: keys.linkCandidates(user?.uid, startedAt, q),
    queryFn: ({ signal }) => api.listMeetings(q ? { q, limit: 30 } : { ...aroundRange(startedAt, LINK_WINDOW_DAYS), limit: 100 }, signal),
    enabled: !!user && enabled,
    select: (page) => page.items,
  });
}

/** Everyone the user meets in the last `days` days (all time when null), most time together first. */
export function usePeople(days: number | null, ready = true) {
  const { api, user } = useAuth();
  return useQuery({
    queryKey: keys.people(user?.uid, days),
    queryFn: ({ signal }) => api.listPeople(days ?? undefined, signal),
    enabled: !!user && ready,
  });
}

export function usePerson(name: string) {
  const { api, user } = useAuth();
  return useQuery({ queryKey: keys.person(user?.uid, name), queryFn: ({ signal }) => api.getPerson(name, signal), enabled: !!user && !!name });
}

/** Renames a person everywhere (or merges them into someone who already has the new name). */
export function useRenamePerson() {
  const { api, user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, newName }: { name: string; newName: string }) => api.renamePerson(name, newName),
    onSuccess: (person, { name }) => {
      qc.removeQueries({ queryKey: keys.person(user?.uid, name), exact: true });
      qc.setQueryData(keys.person(user?.uid, person.name), person);
      void qc.invalidateQueries({ queryKey: keys.allPeople(user?.uid) });
      // Whoever they were merged into, and every meeting, list and task that shows the name.
      void qc.invalidateQueries({ queryKey: keys.allPersons(user?.uid), predicate: (q) => q.queryKey[2] !== person.name.toLocaleLowerCase() });
      void qc.invalidateQueries({ queryKey: keys.allMeetings(user?.uid) });
      void qc.invalidateQueries({ queryKey: keys.allMeetingDetails(user?.uid) });
      void qc.invalidateQueries({ queryKey: keys.allTasks(user?.uid) });
    },
  });
}

export function useReprocessMeeting(id: string) {
  const { api } = useAuth();
  const setMeeting = useSetMeeting();
  return useMutation({ mutationFn: () => api.reprocessMeeting(id), onSuccess: setMeeting });
}

export function useDeleteMeeting() {
  const { api, user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteMeeting(id),
    onSuccess: (_void, id) => {
      qc.removeQueries({ queryKey: keys.meeting(user?.uid, id) });
      qc.setQueriesData<InfiniteData<MeetingPage>>({ queryKey: keys.meetingLists(user?.uid) }, (data) =>
        data ? { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.filter((m) => m.id !== id) })) } : data,
      );
      void qc.invalidateQueries({ queryKey: keys.facets(user?.uid) });
    },
  });
}

export function useDevices() {
  const { api, user } = useAuth();
  return useQuery({ queryKey: keys.devices(user?.uid), queryFn: () => api.listDevices(), enabled: !!user });
}

export function useRevokeDevice() {
  const { api, user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.revokeDevice(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.devices(user?.uid) }),
  });
}

export function useAuthorizeDevice() {
  const { api } = useAuth();
  return useMutation({ mutationFn: api.authorizeDevice });
}

/** Public: the newest DMG, or null before the first build exists. */
export function useLatestDownload() {
  return useQuery({
    queryKey: keys.latestDownload,
    queryFn: ({ signal }) => publicApi.latestDownload(signal),
    staleTime: 5 * 60_000,
  });
}
