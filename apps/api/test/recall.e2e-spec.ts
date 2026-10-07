import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { MeetingDetail } from '@boringtalks/shared';
import { bearer, emulatorToken, startHarness, waitFor, type Harness } from './harness';

/**
 * Meeting bots end to end, with a fake Recall.ai: send a bot, follow it through signed webhooks,
 * import its transcript and audio, summarize. The real API, worker, Postgres, Redis and storage.
 */
const SECRET_KEY = 'e2e webhook key';
const SECRET = `whsec_${Buffer.from(SECRET_KEY).toString('base64')}`;
const word = (text: string, start: number) => ({ text, start_timestamp: { relative: start }, end_timestamp: { relative: start + 0.4 } });
const TRANSCRIPT = [
  { participant: { id: 1, name: 'Dana Smith' }, language_code: 'en', words: [word('Pricing', 1), word('goes', 1.5), word('to', 2), word('29', 2.5)] },
  { participant: { id: 2, name: 'Leo' }, language_code: 'en', words: [word('I', 4), word('will', 4.5), word('send', 5), word('the', 5.5), word('email', 6)] },
];

let h: Harness;
let recall: Server;
let base: string;
const calls: { method: string; path: string; body: string }[] = [];
let bots = 0;
const saved = { ...process.env };

beforeAll(async () => {
  recall = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const path = req.url ?? '';
      calls.push({ method: req.method ?? '', path, body });
      const json = (v: unknown) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(v));
      if (req.headers.authorization !== 'Token e2e-key' && path.startsWith('/api/')) return res.writeHead(401).end('{"detail":"Invalid token"}');
      if (req.method === 'POST' && path === '/api/v1/bot/') return json({ id: `bot-${++bots}` });
      if (req.method === 'POST' && /\/leave_call\/$/.test(path)) return json({});
      if (req.method === 'GET' && /^\/api\/v1\/bot\/bot-\d+\/$/.test(path)) {
        return json({
          id: path.split('/')[4],
          recordings: [
            {
              id: 'rec-1',
              started_at: '2026-10-06T10:00:00Z',
              completed_at: '2026-10-06T10:01:00Z',
              media_shortcuts: { transcript: { status: { code: 'done' }, data: { download_url: `${base}/dl/transcript.json` } } },
            },
          ],
        });
      }
      if (req.method === 'GET' && path.startsWith('/api/v1/audio_mixed/')) return json({ results: [{ data: { download_url: `${base}/dl/audio.mp3` } }] });
      if (path === '/dl/transcript.json') return json(TRANSCRIPT);
      if (path === '/dl/audio.mp3') return res.writeHead(200, { 'content-type': 'audio/mpeg' }).end(Buffer.from('ID3 fake mp3'));
      res.writeHead(404).end('{"detail":"Not found"}');
    });
  });
  await new Promise<void>((r) => recall.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(recall.address() as AddressInfo).port}`;
  Object.assign(process.env, { RECALL_API_KEY: 'e2e-key', RECALL_BASE_URL: base, RECALL_WEBHOOK_SECRET: SECRET });
  h = await startHarness();
});

afterAll(async () => {
  await h?.close();
  await new Promise((r) => recall.close(r));
  process.env = saved;
});

function webhook(event: string, botId: string, subCode: string | null = null) {
  const body = JSON.stringify({ event, data: { bot: { id: botId, metadata: {} }, data: { code: event.split('.')[1], sub_code: subCode, updated_at: new Date().toISOString() } } });
  const id = `msg_${Math.random()}`;
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac('sha256', Buffer.from(SECRET_KEY)).update(`${id}.${ts}.${body}`).digest('base64');
  return h.http
    .post('/integrations/recall/webhook')
    .set({ 'content-type': 'application/json', 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': `v1,${sig}` })
    .send(body);
}

const get = async (token: string, id: string) => (await h.http.get(`/meetings/${id}`).set(bearer(token)).expect(200)).body as MeetingDetail;

describe('meeting bots', () => {
  it('sends a bot, follows it in the call, imports its recording and summarizes it', async () => {
    const token = emulatorToken('bot-user', 'bot@example.com', 'Bo User');
    expect((await h.http.get('/me').set(bearer(token)).expect(200)).body.meetingBot).toBe(true);

    await h.http.post('/bots').set(bearer(token)).send({ meetingUrl: 'https://example.com/not-a-meeting' }).expect(400);
    const sent = (await h.http.post('/bots').set(bearer(token)).send({ meetingUrl: 'https://meet.google.com/abc-defg-hij' }).expect(201)).body as MeetingDetail;
    expect(sent).toMatchObject({ source: 'bot', status: 'recording', bot: { status: 'joining', meetingUrl: 'https://meet.google.com/abc-defg-hij', joinAt: null } });
    const created = calls.find((c) => c.method === 'POST' && c.path === '/api/v1/bot/')!;
    expect(JSON.parse(created.body)).toMatchObject({ meeting_url: 'https://meet.google.com/abc-defg-hij', metadata: { meeting_id: sent.id } });

    // Unsigned webhooks are refused; signed ones move the bot along.
    await h.http.post('/integrations/recall/webhook').send({ event: 'bot.done', data: { bot: { id: 'bot-1' } } }).expect(401);
    await webhook('bot.in_call_recording', 'bot-1').expect(204);
    expect((await get(token, sent.id)).bot?.status).toBe('recording');

    await webhook('bot.call_ended', 'bot-1').expect(204);
    await webhook('bot.done', 'bot-1').expect(204);
    // Recall retries webhooks: a second "done" doesn't import twice.
    await webhook('bot.done', 'bot-1').expect(204);

    const ready = await waitFor(async () => {
      const m = await get(token, sent.id);
      if (m.status === 'failed') throw new Error(m.error ?? 'failed');
      return m.status === 'ready' ? m : null;
    }, 30_000);
    expect(ready.speakers).toEqual(['Dana Smith', 'Leo']);
    expect(ready.segments[1]).toEqual({ speaker: 'Leo', startMs: 4000, endMs: 6400, text: 'I will send the email' });
    expect(ready.hasAudio).toBe(true);
    expect(ready.durationSec).toBe(60);
    expect(ready.bot?.status).toBe('done');
    expect(Buffer.from(await (await fetch(ready.audioUrl!)).arrayBuffer()).toString()).toBe('ID3 fake mp3');
  });

  it('shows why a bot failed, and calls a bot out of the call', async () => {
    const token = emulatorToken('bot-user-2');
    const failing = (await h.http.post('/bots').set(bearer(token)).send({ meetingUrl: 'https://zoom.us/j/123' }).expect(201)).body as MeetingDetail;
    const botId = `bot-${bots}`;
    await webhook('bot.fatal', botId, 'meeting_not_found').expect(204);
    expect(await get(token, failing.id)).toMatchObject({ status: 'failed', error: 'The meeting link didn’t lead to a meeting.', bot: { status: 'failed' } });

    const leaving = (await h.http.post('/bots').set(bearer(token)).send({ meetingUrl: 'https://teams.microsoft.com/l/meetup-join/x', title: 'Board call' }).expect(201)).body as MeetingDetail;
    expect(leaving.title).toBe('Board call');
    const left = (await h.http.post(`/meetings/${leaving.id}/bot/leave`).set(bearer(token)).expect(200)).body as MeetingDetail;
    expect(left.bot?.status).toBe('left');
    expect(calls.some((c) => c.path === `/api/v1/bot/bot-${bots}/leave_call/`)).toBe(true);
    await h.http.post(`/meetings/${leaving.id}/bot/leave`).set(bearer(token)).expect(409);
    // Another user can't touch it.
    await h.http.post(`/meetings/${leaving.id}/bot/leave`).set(bearer(emulatorToken('stranger'))).expect(404);
  });
});
