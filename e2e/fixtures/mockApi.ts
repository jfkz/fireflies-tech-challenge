import type { Page, Route } from '@playwright/test';
import {
  AuthorizeDeviceRequest,
  CreateMeetingRequest,
  MeetingDetail,
  UpdateMeetingRequest,
  UpdateSettingsRequest,
  UploadUrlRequest,
  type Device,
  type LatestDownload,
  type Me,
  type MeetingStatus,
} from '@boringtalks/shared';
import { AUDIO_URL, demoMeeting, device, me as makeMe, processingMeeting, silentWav, toListItem, UPLOAD_HOST } from './data';

export const MOCK_API_URL = 'http://localhost:4999';

export interface Call {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
  headers: Record<string, string>;
}

export interface MockApi {
  me: Me;
  meetings: MeetingDetail[];
  devices: Device[];
  latest: LatestDownload | null;
  calls: Call[];
  uploads: { url: string; contentType: string | undefined; size: number }[];
  /** Status a processing meeting moves to on each GET, so polling can be observed. */
  progression: MeetingStatus[];
  callsTo(method: string, pathPattern: RegExp): Call[];
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type,accept',
  'access-control-max-age': '600',
};

function json(route: Route, status: number, body?: unknown) {
  return route.fulfill({
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
    body: body === undefined ? '' : JSON.stringify(body),
  });
}

function error(route: Route, status: number, message: string) {
  return json(route, status, { statusCode: status, message });
}

/**
 * Installs an in-memory BoringTalks API on the page with page.route. Every
 * request is recorded in `calls`; request bodies are validated with the shared
 * zod schemas, so the web app can't drift from the contract unnoticed.
 */
export async function mockApi(
  page: Page,
  init: { meetings?: MeetingDetail[]; devices?: Device[]; latest?: LatestDownload | null; me?: Partial<Me>; demoOnFirstMe?: boolean } = {},
): Promise<MockApi> {
  let created = false;
  const state: MockApi = {
    me: makeMe(init.me),
    meetings: init.meetings ?? [],
    devices: init.devices ?? [device()],
    latest: init.latest === undefined ? null : init.latest,
    calls: [],
    uploads: [],
    progression: ['transcribing', 'summarizing', 'ready'],
    callsTo(method, pattern) {
      return state.calls.filter((c) => c.method === method && pattern.test(c.path));
    },
  };

  await page.route(`${MOCK_API_URL}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });

    const path = url.pathname;
    let body: unknown = undefined;
    try {
      body = req.postData() ? req.postDataJSON() : undefined;
    } catch {
      body = req.postData();
    }
    const headers = await req.allHeaders();
    state.calls.push({ method, path, query: Object.fromEntries(url.searchParams), body, headers });

    if (path === '/downloads/latest' && method === 'GET') {
      return state.latest ? json(route, 200, state.latest) : error(route, 404, 'No build published yet');
    }
    if (!headers.authorization?.startsWith('Bearer ')) return error(route, 401, 'Missing bearer token');

    // ---- me
    if (path === '/me' && method === 'GET') {
      if (!created && init.demoOnFirstMe !== false) {
        created = true;
        if (state.meetings.length === 0) state.meetings.push(demoMeeting());
      }
      return json(route, 200, state.me);
    }
    if (path === '/me/settings' && method === 'PATCH') {
      const parsed = UpdateSettingsRequest.safeParse(body);
      if (!parsed.success) return error(route, 400, parsed.error.issues[0].message);
      state.me = { ...state.me, ...parsed.data };
      return json(route, 200, state.me);
    }

    // ---- meetings
    if (path === '/meetings' && method === 'GET') {
      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      const speaker = url.searchParams.get('speaker');
      const topic = url.searchParams.get('topic');
      const limit = Number(url.searchParams.get('limit') ?? 20);
      const start = Number(url.searchParams.get('cursor') ?? 0);
      const all = state.meetings
        .filter((m) => !q || [m.title, m.description ?? '', ...m.segments.map((s) => s.text)].join(' ').toLowerCase().includes(q))
        .filter((m) => (!speaker || m.speakers.includes(speaker)) && (!topic || m.topics.includes(topic)))
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      const items = all.slice(start, start + limit).map(toListItem);
      const next = start + limit < all.length ? String(start + limit) : null;
      return json(route, 200, { items, nextCursor: next });
    }
    if (path === '/meetings/facets' && method === 'GET') {
      const count = (values: string[]) =>
        [...values.reduce((m, v) => m.set(v, (m.get(v) ?? 0) + 1), new Map<string, number>())]
          .map(([value, n]) => ({ value, count: n }))
          .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
      return json(route, 200, { speakers: count(state.meetings.flatMap((m) => m.speakers)), topics: count(state.meetings.flatMap((m) => m.topics)) });
    }
    if (path === '/meetings' && method === 'POST') {
      const parsed = CreateMeetingRequest.safeParse(body);
      if (!parsed.success) return error(route, 400, parsed.error.issues[0].message);
      const m = processingMeeting(parsed.data.source as 'browser' | 'upload', parsed.data.title ?? null);
      state.meetings.push(m);
      return json(route, 201, m);
    }

    const match = path.match(/^\/meetings\/([^/]+)(?:\/(upload-url|complete|reprocess))?$/);
    if (match) {
      const [, id, action] = match;
      const i = state.meetings.findIndex((m) => m.id === id);
      if (i < 0) return error(route, 404, 'Meeting not found');
      const m = state.meetings[i];
      const save = (next: MeetingDetail) => (state.meetings[i] = MeetingDetail.parse(next));

      if (!action && method === 'GET') {
        if (m.status !== 'ready' && m.status !== 'failed' && m.status !== 'recording') {
          const at = state.progression.indexOf(m.status);
          const nextStatus = state.progression[Math.min(at + 1, state.progression.length - 1)];
          if (nextStatus === 'ready') {
            const done = demoMeeting({ id: m.id, source: m.source, title: 'Browser test: the summary arrived', startedAt: m.startedAt, audioUrl: AUDIO_URL });
            return json(route, 200, save(done));
          }
          return json(route, 200, save({ ...m, status: nextStatus }));
        }
        return json(route, 200, m);
      }
      if (!action && method === 'PATCH') {
        const parsed = UpdateMeetingRequest.safeParse(body);
        if (!parsed.success) return error(route, 400, parsed.error.issues[0].message);
        let next = m;
        if (parsed.data.title) next = { ...next, title: parsed.data.title };
        const renames = parsed.data.speakers;
        if (renames) {
          if (Object.keys(renames).some((from) => !next.speakers.includes(from))) return error(route, 404, 'Speaker not found');
          const rename = (s: string) => renames[s] ?? s;
          next = { ...next, speakers: [...new Set(next.speakers.map(rename))], segments: next.segments.map((s) => ({ ...s, speaker: rename(s.speaker) })) };
        }
        const ai = parsed.data.actionItem;
        if (ai && next.summary) {
          next = { ...next, summary: { ...next.summary, actionItems: next.summary.actionItems.map((a) => (a.id === ai.id ? { ...a, done: ai.done } : a)) } };
        }
        return json(route, 200, save(next));
      }
      if (!action && method === 'DELETE') {
        state.meetings.splice(i, 1);
        return route.fulfill({ status: 204, headers: CORS });
      }
      if (action === 'upload-url' && method === 'POST') {
        const parsed = UploadUrlRequest.safeParse(body);
        if (!parsed.success) return error(route, 400, parsed.error.issues[0].message);
        return json(route, 200, {
          url: `${UPLOAD_HOST}/users/u/meetings/${id}/audio?X-Amz-Signature=mock`,
          key: `users/u/meetings/${id}/audio`,
          headers: { 'Content-Type': parsed.data.contentType },
          expiresInSec: 900,
        });
      }
      if (action === 'complete' && method === 'POST') {
        return json(route, 200, save({ ...m, status: 'transcribing', hasAudio: true }));
      }
      if (action === 'reprocess' && method === 'POST') {
        return json(route, 200, save({ ...m, status: 'transcribing', error: null }));
      }
    }

    // ---- devices
    if (path === '/devices' && method === 'GET') return json(route, 200, state.devices);
    if (path === '/devices/authorize' && method === 'POST') {
      const parsed = AuthorizeDeviceRequest.safeParse(body);
      if (!parsed.success) return error(route, 400, parsed.error.issues[0].message);
      return json(route, 201, { code: 'MOCK-CODE-1234', expiresInSec: 300, redirectUrl: 'boringtalks://callback?code=MOCK-CODE-1234' });
    }
    const dev = path.match(/^\/devices\/([^/]+)$/);
    if (dev && method === 'DELETE') {
      state.devices = state.devices.filter((d) => d.id !== dev[1]);
      return route.fulfill({ status: 204, headers: CORS });
    }

    return error(route, 404, `No mock for ${method} ${path}`);
  });

  // Presigned storage PUTs.
  await page.route(`${UPLOAD_HOST}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...CORS, 'access-control-allow-headers': 'content-type' } });
    const buf = req.postDataBuffer();
    state.uploads.push({ url: req.url(), contentType: (await req.allHeaders())['content-type'], size: buf?.length ?? 0 });
    return route.fulfill({ status: 200, headers: CORS, body: '' });
  });

  // The demo meeting's audio.
  // Range support matters: without it Chromium treats the media as unseekable.
  const wav = silentWav();
  await page.route(AUDIO_URL, async (route) => {
    const range = (await route.request().allHeaders()).range;
    const m = range?.match(/bytes=(\d+)-(\d*)/);
    if (!m) {
      return route.fulfill({ status: 200, headers: { 'content-type': 'audio/wav', 'accept-ranges': 'bytes', 'content-length': String(wav.length) }, body: wav });
    }
    const start = Number(m[1]);
    const end = m[2] ? Math.min(Number(m[2]), wav.length - 1) : wav.length - 1;
    return route.fulfill({
      status: 206,
      headers: {
        'content-type': 'audio/wav',
        'accept-ranges': 'bytes',
        'content-range': `bytes ${start}-${end}/${wav.length}`,
        'content-length': String(end - start + 1),
      },
      body: wav.subarray(start, end + 1),
    });
  });

  return state;
}
