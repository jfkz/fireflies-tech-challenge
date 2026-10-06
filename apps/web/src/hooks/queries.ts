'use client';

import type { MeetingDetail, MeetingPage, UpdateMeetingRequest } from '@boringtalks/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { publicApi, useAuth } from '@/components/providers/AuthProvider';
import { isProcessing, meetingPollInterval } from '@/lib/status';

/** Query keys, scoped by user so two accounts never share a cache entry. */
export const keys = {
  me: (uid: string | undefined) => ['me', uid] as const,
  meetings: (uid: string | undefined, q: string) => ['meetings', uid, q] as const,
  meetingLists: (uid: string | undefined) => ['meetings', uid] as const,
  meeting: (uid: string | undefined, id: string) => ['meeting', uid, id] as const,
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
    onSuccess: (me) => qc.setQueryData(keys.me(user?.uid), me),
  });
}

/** Cursor-paginated meeting list. `ready` lets the caller wait for GET /me (which creates the account). */
export function useMeetings(q: string, ready = true) {
  const { api, user } = useAuth();
  return useInfiniteQuery({
    queryKey: keys.meetings(user?.uid, q),
    queryFn: ({ pageParam, signal }) => api.listMeetings({ cursor: pageParam, q: q || undefined, limit: 20 }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: MeetingPage) => last.nextCursor ?? undefined,
    enabled: !!user && ready,
    // Keep the status chips moving while anything in the list is still being processed.
    refetchInterval: (query) =>
      query.state.data?.pages.some((p) => p.items.some((m) => isProcessing(m.status))) ? 5000 : false,
  });
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
    void qc.invalidateQueries({ queryKey: keys.meetingLists(user?.uid) });
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
    onSuccess: setMeeting,
  });
}

/** What a PATCH will do, applied locally. */
export function applyUpdate(m: MeetingDetail, body: UpdateMeetingRequest): MeetingDetail {
  let next = m;
  if (body.title !== undefined) next = { ...next, title: body.title };
  const item = body.actionItem;
  if (item && next.summary) {
    next = {
      ...next,
      summary: { ...next.summary, actionItems: next.summary.actionItems.map((a) => (a.id === item.id ? { ...a, done: item.done } : a)) },
    };
  }
  return next;
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
