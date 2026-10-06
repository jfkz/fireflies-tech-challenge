import { createHash } from 'node:crypto';
import type { MeetingDetail, MeetingPage } from '@boringtalks/shared';
import { DEMO_MEETING } from '../src/meetings/demo-meeting';
import { StorageService } from '../src/storage/storage.service';
import { bearer, emulatorToken, startHarness, waitFor, type Harness } from './harness';

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
});

afterAll(async () => {
  await h?.close();
});

const segments = [
  { speaker: 'You', startMs: 0, endMs: 2_000, text: 'Kickoff for the Zanzibar integration.' },
  { speaker: 'Speaker 1', startMs: 2_500, endMs: 5_000, text: 'I will send the API keys by Monday.' },
];

async function createMeeting(token: string, source = 'macos'): Promise<MeetingDetail> {
  const res = await h.http.post('/meetings').set(bearer(token)).send({ source }).expect(201);
  return res.body as MeetingDetail;
}

async function waitForStatus(token: string, id: string, status: string): Promise<MeetingDetail> {
  return waitFor(async () => {
    const res = await h.http.get(`/meetings/${id}`).set(bearer(token));
    const body = res.body as MeetingDetail;
    if (body.status === 'failed') throw new Error(`meeting failed: ${body.error}`);
    return body.status === status ? body : null;
  });
}

async function uploadAudio(token: string, id: string, contentType: string, bytes: Buffer): Promise<string> {
  const res = await h.http.post(`/meetings/${id}/upload-url`).set(bearer(token)).send({ contentType, sizeBytes: bytes.length }).expect(200);
  const put = await fetch(res.body.url, { method: 'PUT', headers: res.body.headers, body: bytes });
  expect(put.status).toBe(200);
  return res.body.key as string;
}

describe('public endpoints', () => {
  it('reports health with db and redis', async () => {
    const res = await h.http.get('/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', checks: { db: true, redis: true } });
  });

  it('answers 404 for downloads before a build exists', async () => {
    await h.http.get('/downloads/latest').expect(404);
  });

  it('requires a token everywhere else', async () => {
    const res = await h.http.get('/meetings').expect(401);
    expect(res.body).toEqual({ statusCode: 401, message: 'Missing bearer token' });
    await h.http.get('/me').set(bearer('garbage')).expect(401);
  });
});

describe('sign-in', () => {
  it('creates the user, seeds a ready demo meeting and sends a welcome email', async () => {
    const token = emulatorToken('new-user', 'new@example.com', 'New User');
    const me = await h.http.get('/me').set(bearer(token)).expect(200);
    expect(me.body).toMatchObject({ email: 'new@example.com', name: 'New User', emailOnReady: true });

    const list = (await h.http.get('/meetings').set(bearer(token)).expect(200)).body as MeetingPage;
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ title: DEMO_MEETING.title, status: 'ready', source: 'demo', actionItemCount: 4 });
    const demo = (await h.http.get(`/meetings/${list.items[0].id}`).set(bearer(token)).expect(200)).body as MeetingDetail;
    expect(demo.segments.length).toBeGreaterThanOrEqual(25);
    expect(demo.summary?.decisions).toHaveLength(4);

    await waitFor(async () => h.mail.sent.find((m) => m.to === 'new@example.com' && m.subject === 'Welcome to BoringTalks'));
    // A second request does not seed again.
    await h.http.get('/me').set(bearer(token)).expect(200);
    expect(((await h.http.get('/meetings').set(bearer(token))).body as MeetingPage).items).toHaveLength(1);
  });

  it('updates settings', async () => {
    const token = emulatorToken('settings-user');
    const res = await h.http.patch('/me/settings').set(bearer(token)).send({ emailOnReady: false }).expect(200);
    expect(res.body.emailOnReady).toBe(false);
  });
});

describe('Mac flow: transcript + audio → summary', () => {
  it('goes from recording to ready with a title, summary and action items', async () => {
    const token = emulatorToken('mac-user', 'mac@example.com');
    const created = await createMeeting(token);
    expect(created.status).toBe('recording');
    expect(created.title).toMatch(/^Meeting on [A-Z][a-z]{2} \d{1,2}, \d{2}:\d{2}$/);

    const audio = Buffer.from('fake m4a bytes '.repeat(100));
    const key = await uploadAudio(token, created.id, 'audio/mp4', audio);
    await h.http.put(`/meetings/${created.id}/transcript`).set(bearer(token)).send({ segments, language: 'en' }).expect(204);

    const completed = await h.http.post(`/meetings/${created.id}/complete`).set(bearer(token)).send({ durationSec: 5 }).expect(200);
    expect(completed.body).toMatchObject({ status: 'summarizing', hasAudio: true, durationSec: 5 });

    const ready = await waitForStatus(token, created.id, 'ready');
    expect(ready.title).toBe('Fake summary: Kickoff for the Zanzibar integration.');
    expect(ready.description).toBeTruthy();
    // The summarizer named "Speaker 1" from the conversation; segments show the name.
    expect(ready.speakers).toEqual(['You', 'Maya']);
    expect(ready.topics).toEqual(['Testing']);
    expect(ready.summary?.actionItems).toEqual([expect.objectContaining({ text: 'Check the fake summary', owner: 'You', done: false })]);
    expect(ready.segments).toEqual([segments[0], { ...segments[1], speaker: 'Maya' }]);

    // Filter by the speaker and the topic, and see them offered as filters.
    const bySpeaker = (await h.http.get('/meetings').query({ speaker: 'Maya' }).set(bearer(token)).expect(200)).body as MeetingPage;
    expect(bySpeaker.items.map((m) => m.id)).toEqual([created.id]);
    const byTopic = (await h.http.get('/meetings').query({ topic: 'Testing' }).set(bearer(token)).expect(200)).body as MeetingPage;
    expect(byTopic.items.map((m) => m.id)).toEqual([created.id]);
    expect(((await h.http.get('/meetings').query({ topic: 'Hiring' }).set(bearer(token)).expect(200)).body as MeetingPage).items).toHaveLength(0);
    const facets = (await h.http.get('/meetings/facets').set(bearer(token)).expect(200)).body;
    expect(facets.topics).toEqual(expect.arrayContaining([{ value: 'Testing', count: 1 }]));
    expect(facets.speakers).toEqual(expect.arrayContaining([{ value: 'Maya', count: 1 }]));

    // The action item is on the tasks page with its due date and meeting.
    // (The account's demo meeting has tasks too; it was seeded on the first request.)
    const tasks = (await h.http.get('/tasks').set(bearer(token)).expect(200)).body;
    expect(tasks.items.filter((t: { meeting: { id: string } }) => t.meeting.id === created.id)).toEqual([
      expect.objectContaining({ text: 'Check the fake summary', due: 'Friday', dueDate: '2026-10-09', done: false, meeting: expect.objectContaining({ id: created.id }) }),
    ]);
    await h.http.get('/tasks').query({ status: 'later' }).set(bearer(token)).expect(400);

    // The calendar counts it on its day.
    const day = ready.startedAt.slice(0, 10);
    const next = new Date(Date.parse(day) + 86_400_000).toISOString().slice(0, 10);
    const stats = (await h.http.get('/meetings/stats').query({ from: day, to: next, tz: 'UTC' }).set(bearer(token)).expect(200)).body;
    expect(stats.days).toEqual([{ date: day, count: 1, totalSec: 5 }]);
    await h.http.get('/meetings/stats').query({ from: day, to: next, tz: 'Nowhere/Land' }).set(bearer(token)).expect(400);

    // Rename a speaker by hand: it sticks, even through a reprocess.
    const renamed = await h.http.patch(`/meetings/${created.id}`).set(bearer(token)).send({ speakers: { Maya: 'Mia' } }).expect(200);
    expect(renamed.body.speakers).toEqual(['You', 'Mia']);
    await h.http.patch(`/meetings/${created.id}`).set(bearer(token)).send({ speakers: { Nobody: 'X' } }).expect(404);

    // The presigned GET serves what was uploaded.
    const played = await fetch(ready.audioUrl!);
    expect(Buffer.from(await played.arrayBuffer())).toEqual(audio);

    await waitFor(async () => h.mail.sent.find((m) => m.to === 'mac@example.com' && m.subject.startsWith('Ready: Fake summary')));

    // Toggle an action item and rename; the summary keeps the user's title on reprocess.
    const itemId = ready.summary!.actionItems[0].id;
    const patched = await h.http
      .patch(`/meetings/${created.id}`)
      .set(bearer(token))
      .send({ title: 'Zanzibar kickoff', actionItem: { id: itemId, done: true } })
      .expect(200);
    expect(patched.body.title).toBe('Zanzibar kickoff');
    expect(patched.body.summary.actionItems[0].done).toBe(true);
    const done = (await h.http.get('/tasks').query({ status: 'done' }).set(bearer(token))).body.items;
    expect(done.map((t: { id: string }) => t.id)).toContain(itemId);

    await h.http.post(`/meetings/${created.id}/reprocess`).set(bearer(token)).expect(200);
    const again = await waitForStatus(token, created.id, 'ready');
    expect(again.title).toBe('Zanzibar kickoff');
    expect(again.speakers).toEqual(['You', 'Mia']);

    // Setting your name renames "You" in past meetings.
    await h.http.patch('/me/settings').set(bearer(token)).send({ name: 'Mac Person' }).expect(200);
    expect(((await h.http.get(`/meetings/${created.id}`).set(bearer(token))).body as MeetingDetail).speakers).toEqual(['Mac', 'Mia']);

    // Delete removes the stored objects too.
    const storage = h.app.get(StorageService);
    expect(await storage.head(key)).not.toBeNull();
    await h.http.delete(`/meetings/${created.id}`).set(bearer(token)).expect(204);
    expect(await storage.head(key)).toBeNull();
    expect(await storage.head(key.replace(/audio\.m4a$/, 'transcript.json'))).toBeNull();
    await h.http.get(`/meetings/${created.id}`).set(bearer(token)).expect(404);
  });
});

describe('browser flow: audio only → transcribe → summarize', () => {
  it('transcribes on the server and becomes ready', async () => {
    const token = emulatorToken('browser-user');
    const created = await createMeeting(token, 'browser');
    await uploadAudio(token, created.id, 'audio/webm', Buffer.alloc(2048, 1));
    const res = await h.http.post(`/meetings/${created.id}/complete`).set(bearer(token)).expect(200);
    expect(res.body.status).toBe('transcribing');

    const ready = await waitForStatus(token, created.id, 'ready');
    expect(ready.segments[0]).toMatchObject({ speaker: 'Speaker 1', text: 'Fake transcript of 2048 bytes.' });
    expect(ready.language).toBe('en');
    expect(ready.title).toBe('Fake summary: Fake transcript of 2048 bytes. We agreed to ship on Friday.');
  });

  it('refuses to complete without transcript or audio, and twice in a row', async () => {
    const token = emulatorToken('browser-user-2');
    const created = await createMeeting(token, 'upload');
    await h.http.post(`/meetings/${created.id}/complete`).set(bearer(token)).expect(422);
    // An upload URL alone is not audio: nothing was PUT yet.
    await h.http.post(`/meetings/${created.id}/upload-url`).set(bearer(token)).send({ contentType: 'audio/mpeg', sizeBytes: 10 }).expect(200);
    await h.http.post(`/meetings/${created.id}/complete`).set(bearer(token)).expect(422);
    await h.http.put(`/meetings/${created.id}/transcript`).set(bearer(token)).send({ segments }).expect(204);
    await h.http.post(`/meetings/${created.id}/complete`).set(bearer(token)).expect(200);
    // A retried complete is a conflict, whether the summary is still running or done.
    await h.http.post(`/meetings/${created.id}/complete`).set(bearer(token)).expect(409);
    await waitForStatus(token, created.id, 'ready');
    await h.http.post(`/meetings/${created.id}/complete`).set(bearer(token)).expect(409);
  });
});

describe('Mac app contract', () => {
  it('creates a meeting once per Idempotency-Key', async () => {
    const token = emulatorToken('idem-user');
    const key = 'upload-queue/3F2A-91C0:create';
    const first = await h.http.post('/meetings').set(bearer(token)).set('Idempotency-Key', key).send({ source: 'macos' }).expect(201);
    const retry = await h.http.post('/meetings').set(bearer(token)).set('Idempotency-Key', key).send({ source: 'macos' }).expect(200);
    expect(retry.body.id).toBe(first.body.id);
    // The retry sees the meeting as it is now, e.g. with its transcript.
    await h.http.put(`/meetings/${first.body.id}/transcript`).set(bearer(token)).send({ segments }).expect(204);
    const later = await h.http.post('/meetings').set(bearer(token)).set('Idempotency-Key', key).send({ source: 'macos' }).expect(200);
    expect(later.body.segments).toEqual(segments);
    // Same key, another user: an independent meeting.
    const other = await h.http.post('/meetings').set(bearer(emulatorToken('idem-other'))).set('Idempotency-Key', key).send({ source: 'macos' }).expect(201);
    expect(other.body.id).not.toBe(first.body.id);
    // Without a key every create is new.
    const a = await h.http.post('/meetings').set(bearer(token)).send({ source: 'macos' }).expect(201);
    const b = await h.http.post('/meetings').set(bearer(token)).send({ source: 'macos' }).expect(201);
    expect(a.body.id).not.toBe(b.body.id);
    const list = (await h.http.get('/meetings?limit=10').set(bearer(token)).expect(200)).body as MeetingPage;
    expect(list.items.filter((i) => i.id === first.body.id)).toHaveLength(1);

    const bad = await h.http.post('/meetings').set(bearer(token)).set('Idempotency-Key', 'k'.repeat(201)).send({ source: 'macos' }).expect(400);
    expect(bad.body.issues).toEqual([{ path: 'Idempotency-Key', message: 'Idempotency-Key must be at most 200 characters' }]);
  });

  it('replaces the transcript on a second PUT and 404s a deleted meeting', async () => {
    const token = emulatorToken('replace-user');
    const m = await createMeeting(token);
    await h.http.put(`/meetings/${m.id}/transcript`).set(bearer(token)).send({ segments }).expect(204);
    const replacement = [{ speaker: 'You', startMs: 0, endMs: 900, text: 'Only this line now.' }];
    await h.http.put(`/meetings/${m.id}/transcript`).set(bearer(token)).send({ segments: replacement }).expect(204);
    const detail = (await h.http.get(`/meetings/${m.id}`).set(bearer(token)).expect(200)).body as MeetingDetail;
    expect(detail.segments).toEqual(replacement);
    expect(detail.speakers).toEqual(['You']);

    await h.http.delete(`/meetings/${m.id}`).set(bearer(token)).expect(204);
    await h.http.get(`/meetings/${m.id}`).set(bearer(token)).expect(404);
    await h.http.post(`/meetings/${m.id}/complete`).set(bearer(token)).expect(404);
    await h.http.put(`/meetings/${m.id}/transcript`).set(bearer(token)).send({ segments }).expect(404);
    await h.http.delete(`/meetings/${m.id}`).set(bearer(token)).expect(404);
  });
});

describe('device link', () => {
  it('authorizes a Mac with PKCE, lets it call the API and revokes it', async () => {
    const firebase = emulatorToken('device-user', 'device@example.com', 'Dev');
    const verifier = 'v'.repeat(20) + 'erifier-with-enough-entropy-1234567890';
    const challenge = createHash('sha256').update(verifier).digest('base64url');

    const auth = await h.http.post('/devices/authorize').set(bearer(firebase)).send({ codeChallenge: challenge, deviceName: "Dev's MacBook" }).expect(201);
    expect(auth.body.redirectUrl).toBe(`boringtalks://callback?code=${auth.body.code}`);

    await h.http.post('/devices/token').send({ code: auth.body.code, codeVerifier: 'w'.repeat(43) }).expect(400);
    // A wrong verifier burns the code.
    await h.http.post('/devices/token').send({ code: auth.body.code, codeVerifier: verifier }).expect(400);

    const auth2 = await h.http.post('/devices/authorize').set(bearer(firebase)).send({ codeChallenge: challenge, deviceName: "Dev's MacBook" }).expect(201);
    const tok = await h.http.post('/devices/token').send({ code: auth2.body.code, codeVerifier: verifier }).expect(200);
    expect(tok.body).toMatchObject({ user: { email: 'device@example.com', name: 'Dev' } });
    const deviceToken = tok.body.token as string;
    expect(deviceToken.startsWith('btd_')).toBe(true);
    await h.http.post('/devices/token').send({ code: auth2.body.code, codeVerifier: verifier }).expect(400);

    const page = await h.http.get('/meetings?limit=5').set(bearer(deviceToken)).expect(200);
    expect(page.body.items).toHaveLength(1);
    await createMeeting(deviceToken);
    await h.http.post('/devices/authorize').set(bearer(deviceToken)).send({ codeChallenge: challenge, deviceName: 'x' }).expect(403);

    const devices = await h.http.get('/devices').set(bearer(firebase)).expect(200);
    expect(devices.body).toEqual([expect.objectContaining({ id: tok.body.deviceId, name: "Dev's MacBook", lastSeenAt: expect.any(String) })]);
    await waitFor(async () => h.mail.sent.find((m) => m.to === 'device@example.com' && m.subject === "New Mac connected: Dev's MacBook"));

    await h.http.delete(`/devices/${tok.body.deviceId}`).set(bearer(firebase)).expect(204);
    await h.http.get('/meetings').set(bearer(deviceToken)).expect(401);
    await h.http.delete(`/devices/${tok.body.deviceId}`).set(bearer(firebase)).expect(404);
  });
});

describe('isolation and validation', () => {
  it("hides another user's meeting behind a 404", async () => {
    const owner = emulatorToken('owner');
    const intruder = emulatorToken('intruder');
    const m = await createMeeting(owner);
    await h.http.get(`/meetings/${m.id}`).set(bearer(intruder)).expect(404);
    await h.http.patch(`/meetings/${m.id}`).set(bearer(intruder)).send({ title: 'mine' }).expect(404);
    await h.http.delete(`/meetings/${m.id}`).set(bearer(intruder)).expect(404);
    await h.http.post(`/meetings/${m.id}/upload-url`).set(bearer(intruder)).send({ contentType: 'audio/mp4', sizeBytes: 1 }).expect(404);
    await h.http.get('/meetings/not-a-uuid').set(bearer(owner)).expect(404);
  });

  it('returns 400 with issues for invalid bodies', async () => {
    const token = emulatorToken('validator');
    const res = await h.http.post('/meetings').set(bearer(token)).send({ source: 'demo', title: 5 }).expect(400);
    expect(res.body).toEqual({
      statusCode: 400,
      message: 'Validation failed',
      issues: expect.arrayContaining([expect.objectContaining({ path: 'source' }), expect.objectContaining({ path: 'title' })]),
    });
    const m = await createMeeting(token);
    const bad = await h.http
      .put(`/meetings/${m.id}/transcript`)
      .set(bearer(token))
      .send({ segments: [{ speaker: 'A', startMs: 10, endMs: 5, text: 'x' }] })
      .expect(400);
    expect(bad.body.issues).toEqual([{ path: 'segments.0.endMs', message: 'endMs must not be before startMs' }]);
    await h.http.get('/meetings?limit=500').set(bearer(token)).expect(400);
    await h.http.get('/meetings?cursor=forged').set(bearer(token)).expect(400);
  });
});

describe('pagination and search', () => {
  it('pages newest first and finds meetings by transcript text', async () => {
    const token = emulatorToken('pager');
    for (let i = 0; i < 5; i++) {
      const startedAt = new Date(Date.UTC(2026, 0, 10 + i, 9)).toISOString();
      const m = (await h.http.post('/meetings').set(bearer(token)).send({ source: 'macos', startedAt, title: `Pager ${i}` }).expect(201)).body;
      const word = i === 2 ? 'quokka' : 'ordinary';
      await h.http
        .put(`/meetings/${m.id}/transcript`)
        .set(bearer(token))
        .send({ segments: [{ speaker: 'You', startMs: 0, endMs: 10, text: `An ${word} conversation` }] })
        .expect(204);
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const qs: string = cursor ? `?limit=2&cursor=${cursor}` : '?limit=2';
      const page = (await h.http.get(`/meetings${qs}`).set(bearer(token)).expect(200)).body as MeetingPage;
      seen.push(...page.items.map((i) => i.title));
      cursor = page.nextCursor;
    } while (cursor);
    // The demo meeting is the newest (yesterday), then Pager 4..0.
    expect(seen).toEqual([DEMO_MEETING.title, 'Pager 4', 'Pager 3', 'Pager 2', 'Pager 1', 'Pager 0']);

    const found = (await h.http.get('/meetings?q=quokka').set(bearer(token)).expect(200)).body as MeetingPage;
    expect(found.items.map((i) => i.title)).toEqual(['Pager 2']);
    const byTitle = (await h.http.get(`/meetings?q=${encodeURIComponent('"Pager 3"')}`).set(bearer(token)).expect(200)).body as MeetingPage;
    expect(byTitle.items.map((i) => i.title)).toEqual(['Pager 3']);
    const none = (await h.http.get('/meetings?q=quokka').set(bearer(emulatorToken('other-pager'))).expect(200)).body as MeetingPage;
    expect(none.items).toEqual([]);
  });
});
