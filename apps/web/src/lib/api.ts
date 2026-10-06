import {
  ApiError,
  AuthorizeDeviceResponse,
  Device,
  LatestDownload,
  Me,
  MeetingDetail,
  MeetingPage,
  UploadUrlResponse,
  type AuthorizeDeviceRequest,
  type CompleteMeetingRequest,
  type CreateMeetingRequest,
  type ListMeetingsQuery,
  type UpdateMeetingRequest,
  type UpdateSettingsRequest,
  type UploadUrlRequest,
} from '@boringtalks/shared';

import { ApiRequestError } from './api-error';

export { ApiRequestError };

export type TokenGetter = () => Promise<string | null>;

export interface ApiClientOptions {
  baseUrl: string;
  getToken: TokenGetter;
  fetch?: typeof fetch;
}

/** Anything with zod's safeParse: the shared schemas. */
interface Schema<T> {
  safeParse(data: unknown): { success: true; data: T } | { success: false; error: { issues: { message: string }[] } };
}

interface RequestOptions<T> {
  schema?: Schema<T>;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  /** Public endpoints skip the Authorization header. */
  auth?: boolean;
  signal?: AbortSignal;
}

const DeviceList = Device.array();

export type ApiClient = ReturnType<typeof createApiClient>;

export function createApiClient({ baseUrl, getToken, fetch: fetchImpl }: ApiClientOptions) {
  const base = baseUrl.replace(/\/+$/, '');
  const doFetch = fetchImpl ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));

  async function request<T>(method: string, path: string, opts: RequestOptions<T> = {}): Promise<T> {
    const url = new URL(base + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.auth !== false) {
      const token = await getToken();
      if (!token) throw new ApiRequestError('You are signed out. Sign in and try again.', 401);
      headers.Authorization = `Bearer ${token}`;
    }

    let res: Response;
    try {
      res = await doFetch(url.toString(), {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: opts.signal,
      });
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err;
      throw new ApiRequestError('Could not reach the BoringTalks API. Check your connection and try again.', 0);
    }

    if (!res.ok) {
      const json = await res.json().catch(() => null);
      const parsed = ApiError.safeParse(json);
      const body = parsed.success ? parsed.data : null;
      throw new ApiRequestError(body?.message ?? `Request failed with status ${res.status}`, res.status, body);
    }
    if (res.status === 204 || !opts.schema) return undefined as T;
    const json = await res.json().catch(() => {
      throw new ApiRequestError('The API answered with something that is not JSON.', res.status);
    });
    const parsed = opts.schema.safeParse(json);
    if (!parsed.success) {
      throw new ApiRequestError(`Unexpected response from ${method} ${path}: ${parsed.error.issues[0]?.message ?? 'invalid'}`, res.status);
    }
    return parsed.data;
  }

  return {
    me: () => request('GET', '/me', { schema: Me }),
    updateSettings: (body: UpdateSettingsRequest) => request('PATCH', '/me/settings', { schema: Me, body }),

    listMeetings: (q: Partial<ListMeetingsQuery> = {}, signal?: AbortSignal) =>
      request('GET', '/meetings', { schema: MeetingPage, query: { cursor: q.cursor, limit: q.limit, q: q.q }, signal }),
    createMeeting: (body: CreateMeetingRequest) => request('POST', '/meetings', { schema: MeetingDetail, body }),
    getMeeting: (id: string, signal?: AbortSignal) => request('GET', `/meetings/${encodeURIComponent(id)}`, { schema: MeetingDetail, signal }),
    updateMeeting: (id: string, body: UpdateMeetingRequest) =>
      request('PATCH', `/meetings/${encodeURIComponent(id)}`, { schema: MeetingDetail, body }),
    deleteMeeting: (id: string) => request<void>('DELETE', `/meetings/${encodeURIComponent(id)}`),
    uploadUrl: (id: string, body: UploadUrlRequest) =>
      request('POST', `/meetings/${encodeURIComponent(id)}/upload-url`, { schema: UploadUrlResponse, body }),
    completeMeeting: (id: string, body: CompleteMeetingRequest = {}) =>
      request('POST', `/meetings/${encodeURIComponent(id)}/complete`, { schema: MeetingDetail, body }),
    reprocessMeeting: (id: string) => request('POST', `/meetings/${encodeURIComponent(id)}/reprocess`, { schema: MeetingDetail, body: {} }),

    authorizeDevice: (body: AuthorizeDeviceRequest) => request('POST', '/devices/authorize', { schema: AuthorizeDeviceResponse, body }),
    listDevices: () => request('GET', '/devices', { schema: DeviceList }),
    revokeDevice: (id: string) => request<void>('DELETE', `/devices/${encodeURIComponent(id)}`),

    /** The newest Mac build, or null while there is none yet (404). */
    latestDownload: async (signal?: AbortSignal) => {
      try {
        return await request('GET', '/downloads/latest', { schema: LatestDownload, auth: false, signal });
      } catch (err) {
        if (err instanceof ApiRequestError && err.status === 404) return null;
        throw err;
      }
    },
  };
}
