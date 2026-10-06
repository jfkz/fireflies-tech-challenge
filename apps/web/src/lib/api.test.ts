import { describe, expect, it, vi } from 'vitest';
import { ApiRequestError, createApiClient } from './api';

const ME = { id: '7b0c4c9e-2c1f-4d8e-9a65-0f3f1c2a9b10', email: 'a@b.co', name: null, emailOnReady: true, createdAt: '2026-10-01T10:00:00.000Z' };

function setup(response: Response | (() => Promise<Response>), token: string | null = 'tok') {
  const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(typeof response === 'function' ? response : () => Promise.resolve(response));
  const api = createApiClient({ baseUrl: 'https://api.test/', getToken: async () => token, fetch: fetch as unknown as typeof globalThis.fetch });
  return { api, fetch };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('api client', () => {
  it('sends the Firebase ID token as a bearer token and parses with the shared schema', async () => {
    const { api, fetch } = setup(json(ME));
    await expect(api.me()).resolves.toEqual(ME);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.test/me');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('builds query strings and drops empty values', async () => {
    const { api, fetch } = setup(json({ items: [], nextCursor: null }));
    await api.listMeetings({ cursor: 'c1', limit: 20, q: '' });
    expect(fetch.mock.calls[0][0]).toBe('https://api.test/meetings?cursor=c1&limit=20');
  });

  it('sends JSON bodies with a content type', async () => {
    const { api, fetch } = setup(json(ME));
    await api.updateSettings({ emailOnReady: false });
    const init = fetch.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('PATCH');
    expect(init.body).toBe('{"emailOnReady":false}');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('turns ApiError bodies into ApiRequestError with the server message', async () => {
    const { api } = setup(json({ statusCode: 403, message: 'Not your meeting' }, 403));
    const err = await api.getMeeting('x').catch((e) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err).toMatchObject({ status: 403, message: 'Not your meeting', body: { statusCode: 403 } });
  });

  it('falls back to the status code when the error body is not an ApiError', async () => {
    const { api } = setup(new Response('<html>bad gateway</html>', { status: 502 }));
    await expect(api.me()).rejects.toMatchObject({ status: 502, message: 'Request failed with status 502', body: null });
  });

  it('rejects responses that do not match the contract', async () => {
    const { api } = setup(json({ id: 'not-a-uuid' }));
    await expect(api.me()).rejects.toThrow(/Unexpected response from GET \/me/);
  });

  it('rejects non-JSON success bodies', async () => {
    const { api } = setup(new Response('nope', { status: 200 }));
    await expect(api.me()).rejects.toThrow(/not JSON/);
  });

  it('reports network failures in plain words', async () => {
    const { api } = setup(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(api.me()).rejects.toMatchObject({ status: 0, message: expect.stringContaining('Could not reach') });
  });

  it('rethrows aborts untouched', async () => {
    const abort = new DOMException('aborted', 'AbortError');
    const { api } = setup(() => Promise.reject(abort));
    await expect(api.me()).rejects.toBe(abort);
  });

  it('refuses to call authenticated endpoints without a token', async () => {
    const { api, fetch } = setup(json(ME), null);
    await expect(api.me()).rejects.toMatchObject({ status: 401 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns undefined for 204 responses', async () => {
    const { api } = setup(new Response(null, { status: 204 }));
    await expect(api.deleteMeeting('m1')).resolves.toBeUndefined();
  });

  it('encodes ids in paths', async () => {
    const { api, fetch } = setup(new Response(null, { status: 204 }));
    await api.revokeDevice('a/b');
    expect(fetch.mock.calls[0][0]).toBe('https://api.test/devices/a%2Fb');
  });

  describe('latestDownload', () => {
    const latest = { version: '1.0', build: '3', url: 'https://d.test/a.dmg', sizeBytes: 10, minimumOs: '26.0', notarized: true, publishedAt: '2026-10-01T10:00:00.000Z' };

    it('is public: no Authorization header even without a user', async () => {
      const { api, fetch } = setup(json(latest), null);
      await expect(api.latestDownload()).resolves.toEqual(latest);
      expect((fetch.mock.calls[0][1] as RequestInit & { headers: Record<string, string> }).headers.Authorization).toBeUndefined();
    });

    it('is null while no build exists (404)', async () => {
      const { api } = setup(json({ statusCode: 404, message: 'none' }, 404));
      await expect(api.latestDownload()).resolves.toBeNull();
    });

    it('still throws other errors', async () => {
      const { api } = setup(json({ statusCode: 500, message: 'boom' }, 500));
      await expect(api.latestDownload()).rejects.toMatchObject({ status: 500 });
    });
  });

  it('covers every endpoint with the right method and path', async () => {
    const m = {
      id: '7b0c4c9e-2c1f-4d8e-9a65-0f3f1c2a9b10',
      title: 't',
      description: null,
      status: 'ready',
      source: 'browser',
      startedAt: '2026-10-01T10:00:00.000Z',
      durationSec: 1,
      speakers: [],
      topics: [],
      actionItemCount: 0,
      hasAudio: false,
      language: null,
      error: null,
      summary: null,
      segments: [],
      audioUrl: null,
    };
    const routes: Record<string, unknown> = {
      'POST /meetings': m,
      'PATCH /meetings/1': m,
      'POST /meetings/1/upload-url': { url: 'https://r2.test/x', key: 'k', headers: {}, expiresInSec: 60 },
      'POST /meetings/1/complete': m,
      'POST /meetings/1/reprocess': m,
      'POST /devices/authorize': { code: 'c', expiresInSec: 60, redirectUrl: 'boringtalks://callback?code=c' },
      'GET /devices': [],
      'GET /meetings/facets': { speakers: [{ value: 'Maya', count: 2 }], topics: [] },
      'GET /meetings': { items: [], nextCursor: null },
    };
    const fetch = vi.fn((url: string, init: RequestInit) => {
      const key = `${init.method} ${new URL(url).pathname}`;
      return Promise.resolve(json(routes[key] ?? { statusCode: 404, message: key }, routes[key] ? 200 : 404));
    });
    const api = createApiClient({ baseUrl: 'https://api.test', getToken: async () => 't', fetch: fetch as unknown as typeof globalThis.fetch });
    await api.createMeeting({ source: 'browser' });
    await api.updateMeeting('1', { title: 'x' });
    await api.uploadUrl('1', { contentType: 'audio/webm', sizeBytes: 5 });
    await api.completeMeeting('1', { durationSec: 3 });
    await api.reprocessMeeting('1');
    await api.authorizeDevice({ codeChallenge: 'a'.repeat(43), deviceName: 'Mac' });
    await expect(api.listDevices()).resolves.toEqual([]);
    await expect(api.meetingFacets()).resolves.toMatchObject({ speakers: [{ value: 'Maya' }] });
    await api.listMeetings({ speaker: 'Maya', topic: 'Pricing', from: '2026-10-01T00:00:00Z', to: '2026-10-02T00:00:00Z' });
    const listed = new URL(fetch.mock.calls.at(-1)![0]);
    expect(Object.fromEntries(listed.searchParams)).toEqual({ speaker: 'Maya', topic: 'Pricing', from: '2026-10-01T00:00:00Z', to: '2026-10-02T00:00:00Z' });
    expect(fetch).toHaveBeenCalledTimes(9);
  });
});
