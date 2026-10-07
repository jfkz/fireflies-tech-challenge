import { createHmac } from 'node:crypto';
import { BadGatewayException, ConflictException, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import { meeting, testConfig, user } from '../testing/fixtures';
import { BotImportService, NotReadyYet } from './bot-import.service';
import { BotsController } from './bots.controller';
import { BotsService } from './bots.service';
import { RecallClient, RecallError, recallMessage, type RecallTranscriptEntry } from './recall.client';
import { participantLabel, recallLanguage, recallToSegments } from './recall-transcript';
import { botFailureMessage, botStatusFor, verifyRecallWebhook } from './recall-webhook';

const SECRET = `whsec_${Buffer.from('a very secret key').toString('base64')}`;

function sign(body: string, id = 'msg_1', ts = Math.floor(Date.now() / 1000), prefix = 'webhook') {
  const sig = createHmac('sha256', Buffer.from('a very secret key')).update(`${id}.${ts}.${body}`).digest('base64');
  return { [`${prefix}-id`]: id, [`${prefix}-timestamp`]: String(ts), [`${prefix}-signature`]: `v1,${sig}` };
}

const word = (text: string, start: number, end: number) => ({ text, start_timestamp: { relative: start }, end_timestamp: { relative: end } });

describe('Recall webhooks', () => {
  const body = JSON.stringify({ event: 'bot.done' });

  it('accepts signed requests (new and Svix headers) and refuses everything else', () => {
    expect(verifyRecallWebhook(SECRET, sign(body), body)).toBe(true);
    expect(verifyRecallWebhook(SECRET, sign(body, 'm', undefined, 'svix'), body)).toBe(true);
    expect(verifyRecallWebhook(SECRET, { ...sign(body), 'webhook-signature': 'v1,AAAA v1,BBBB' }, body)).toBe(false);
    expect(verifyRecallWebhook(SECRET, sign(body), `${body} `)).toBe(false);
    expect(verifyRecallWebhook(SECRET, sign(body, 'm', Math.floor(Date.now() / 1000) - 3600), body)).toBe(false);
    expect(verifyRecallWebhook(SECRET, {}, body)).toBe(false);
    expect(verifyRecallWebhook(`whsec_${Buffer.from('other').toString('base64')}`, sign(body), body)).toBe(false);
  });

  it('maps bot events to statuses and failures to words', () => {
    expect(botStatusFor('bot.joining_call')).toBe('joining');
    expect(botStatusFor('bot.in_waiting_room')).toBe('waiting_room');
    expect(botStatusFor('bot.in_call_recording')).toBe('recording');
    expect(botStatusFor('bot.recording_permission_allowed')).toBe('in_call');
    expect(botStatusFor('bot.call_ended')).toBe('left');
    expect(botStatusFor('bot.done')).toBe('done');
    expect(botStatusFor('bot.fatal')).toBe('failed');
    expect(botStatusFor('bot.breakout_room_opened')).toBeNull();
    expect(botFailureMessage('bot.fatal', 'meeting_not_found')).toBe('The meeting link didn’t lead to a meeting.');
    expect(botFailureMessage('bot.fatal', 'some_new_code')).toBe('The bot couldn’t record the meeting (some new code).');
    expect(botFailureMessage('bot.recording_permission_denied', null)).toContain('didn’t allow');
  });
});

describe('Recall transcript', () => {
  const entries: RecallTranscriptEntry[] = [
    { participant: { id: 1, name: 'Dana Smith' }, language_code: 'en-US', words: [word('Pricing', 1.2, 1.6), word('is', 1.7, 1.8), word('done', 1.9, 2.4), word('.', 2.4, 2.4)] },
    { participant: { id: 7, name: null }, language_code: 'en-US', words: [word('Great', 3, 3.5)] },
    { participant: { id: 8, name: '  ' }, words: [word(' ', 4, 4)] },
    { participant: { id: 9, name: null }, words: [word('Bye', 5, 5.2)] },
  ];

  it('turns participant blocks into segments with real names and times in ms', () => {
    expect(recallToSegments(entries)).toEqual([
      { speaker: 'Dana Smith', startMs: 1200, endMs: 2400, text: 'Pricing is done.' },
      { speaker: 'Speaker 1', startMs: 3000, endMs: 3500, text: 'Great' },
      { speaker: 'Speaker 2', startMs: 5000, endMs: 5200, text: 'Bye' },
    ]);
    expect(recallLanguage(entries)).toBe('en');
    expect(recallLanguage([])).toBeNull();
    expect(participantLabel({ id: 3, name: 'x'.repeat(100) }, new Map())).toHaveLength(80);
  });
});

describe('RecallClient', () => {
  const fetchMock = vi.fn();
  beforeEach(() => vi.stubGlobal('fetch', fetchMock));
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });
  const client = new RecallClient(testConfig({ RECALL_API_KEY: 'k', RECALL_BASE_URL: 'https://eu-central-1.recall.ai/' }));
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  it('creates bots in the configured region with the token and a transcript + mixed audio', async () => {
    fetchMock.mockResolvedValueOnce(ok({ id: 'bot-1' }));
    await expect(client.createBot({ meetingUrl: 'https://meet.google.com/abc', joinAt: new Date('2026-10-07T10:00:00Z'), metadata: { meeting_id: 'm' } })).resolves.toEqual({ id: 'bot-1' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://eu-central-1.recall.ai/api/v1/bot/');
    expect(init.headers.Authorization).toBe('Token k');
    expect(JSON.parse(init.body)).toMatchObject({
      meeting_url: 'https://meet.google.com/abc',
      bot_name: 'BoringTalks Notetaker',
      join_at: '2026-10-07T10:00:00.000Z',
      recording_config: { transcript: { provider: { recallai_streaming: { mode: 'prioritize_accuracy' } } }, audio_mixed_mp3: {} },
    });
  });

  it('reads bots, mixed audio and downloads, and makes bots leave', async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ id: 'b', recordings: [] }))
      .mockResolvedValueOnce(ok({ results: [{ data: { download_url: null } }, { data: { download_url: 'https://dl/a.mp3' } }] }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])))
      .mockResolvedValueOnce(new Response('', { status: 200 }));
    expect((await client.getBot('b')).id).toBe('b');
    await expect(client.audioMixedUrl('r 1')).resolves.toBe('https://dl/a.mp3');
    expect(fetchMock.mock.calls[1][0]).toBe('https://eu-central-1.recall.ai/api/v1/audio_mixed/?recording_id=r%201');
    await expect(client.download('https://dl/a.mp3')).resolves.toEqual(new Uint8Array([1, 2, 3]));
    await client.leaveCall('b');
    expect(fetchMock.mock.calls[3][0]).toBe('https://eu-central-1.recall.ai/api/v1/bot/b/leave_call/');
  });

  it('turns errors into readable messages, and refuses without a key', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ meeting_url: ['Invalid meeting URL'] }), { status: 400 }));
    await expect(client.getBot('b')).rejects.toMatchObject({ message: 'Invalid meeting URL', status: 400 });
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 404 }));
    await expect(client.download('https://dl/x')).rejects.toBeInstanceOf(RecallError);
    expect(recallMessage('{"detail":"Throttled"}')).toBe('Throttled');
    expect(recallMessage('<html>')).toBeNull();
    const off = new RecallClient(testConfig());
    expect(off.enabled).toBe(false);
    await expect(off.getBot('b')).rejects.toMatchObject({ status: 503 });
  });
});

function botsSetup(enabled = true) {
  const repo = { create: vi.fn(), update: vi.fn(), delete: vi.fn(), findOwned: vi.fn(), findByBotId: vi.fn(), transition: vi.fn() };
  const recall = { enabled, createBot: vi.fn(), leaveCall: vi.fn() };
  const jobs = { importBot: vi.fn() };
  const service = new BotsService(repo as never, recall as never, jobs as never, testConfig());
  return { repo, recall, jobs, service };
}

describe('BotsService', () => {
  it('creates a recording meeting and sends a bot to it', async () => {
    const { repo, recall, service } = botsSetup();
    const m = meeting({ source: 'bot', botStatus: 'joining', botMeetingUrl: 'https://zoom.us/j/1' });
    repo.create.mockResolvedValue(m);
    recall.createBot.mockResolvedValue({ id: 'bot-1' });
    repo.update.mockResolvedValue({ ...m, botId: 'bot-1' });
    const d = await service.send(user(), { meetingUrl: 'https://zoom.us/j/1' });
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ source: 'bot', status: 'recording', botStatus: 'joining', titleLocked: false }));
    expect(recall.createBot).toHaveBeenCalledWith(expect.objectContaining({ meetingUrl: 'https://zoom.us/j/1', metadata: expect.objectContaining({ meeting_id: m.id }) }));
    expect(d.bot).toEqual({ status: 'joining', meetingUrl: 'https://zoom.us/j/1', joinAt: null });
  });

  it('schedules a bot for later, and cleans up when Recall says no', async () => {
    const { repo, recall, service } = botsSetup();
    repo.create.mockImplementation(async (v) => meeting(v));
    recall.createBot.mockRejectedValueOnce(new RecallError('Invalid meeting URL', 400));
    await expect(service.send(user(), { meetingUrl: 'https://zoom.us/j/1', joinAt: '2099-01-01T10:00:00Z', title: 'Board call' })).rejects.toThrow(
      new BadGatewayException('The bot can’t join: Invalid meeting URL'),
    );
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ botStatus: 'scheduled', titleLocked: true, title: 'Board call', startedAt: new Date('2099-01-01T10:00:00Z') }));
    expect(repo.delete).toHaveBeenCalled();
    recall.createBot.mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(service.send(user(), { meetingUrl: 'https://zoom.us/j/1' })).rejects.toThrow(/try again/);
  });

  it('is unavailable without Recall configured', async () => {
    await expect(botsSetup(false).service.send(user(), { meetingUrl: 'https://zoom.us/j/1' })).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('calls a bot out of the call once', async () => {
    const { repo, recall, service } = botsSetup();
    repo.findOwned.mockResolvedValueOnce(meeting({ botId: 'b', botStatus: 'recording', botMeetingUrl: 'u' }));
    repo.update.mockResolvedValue(meeting({ botId: 'b', botStatus: 'left', botMeetingUrl: 'u' }));
    expect((await service.leave(user(), meeting().id)).bot?.status).toBe('left');
    expect(recall.leaveCall).toHaveBeenCalledWith('b');
    repo.findOwned.mockResolvedValueOnce(meeting({ botId: 'b', botStatus: 'done' }));
    await expect(service.leave(user(), meeting().id)).rejects.toBeInstanceOf(ConflictException);
    repo.findOwned.mockResolvedValueOnce(meeting());
    await expect(service.leave(user(), meeting().id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('follows webhooks: status updates, import when done, failure with a reason', async () => {
    const { repo, jobs, service } = botsSetup();
    const m = meeting({ botId: 'b', botStatus: 'joining', attempts: 0 });
    repo.findByBotId.mockResolvedValue(m);
    await service.handleWebhook({ event: 'bot.in_call_recording', data: { bot: { id: 'b' } } });
    expect(repo.update).toHaveBeenLastCalledWith(m.id, { botStatus: 'recording' });
    await service.handleWebhook({ event: 'bot.done', data: { bot: { id: 'b' } } });
    expect(jobs.importBot).toHaveBeenCalledWith(m.id, 0);
    await service.handleWebhook({ event: 'bot.fatal', data: { bot: { id: 'b' }, data: { code: 'fatal', sub_code: 'meeting_not_found' } } });
    expect(repo.transition).toHaveBeenCalledWith(m.id, 'recording', { status: 'failed', error: 'The meeting link didn’t lead to a meeting.' });

    // Unknown bots, events we don't track, and bots that are already finished are ignored.
    repo.update.mockClear();
    repo.findByBotId.mockResolvedValueOnce(null);
    await service.handleWebhook({ event: 'bot.done', data: { bot: { id: 'other-env' } } });
    await service.handleWebhook({ event: 'bot.breakout_room_opened', data: { bot: { id: 'b' } } });
    repo.findByBotId.mockResolvedValueOnce({ ...m, botStatus: 'done' });
    await service.handleWebhook({ event: 'bot.call_ended', data: { bot: { id: 'b' } } });
    expect(repo.update).not.toHaveBeenCalled();
  });
});

describe('BotsController', () => {
  it('checks the webhook signature before anything else', async () => {
    const bots = { send: vi.fn(() => 'sent'), leave: vi.fn(() => 'left'), handleWebhook: vi.fn() };
    const c = new BotsController(bots as never, testConfig({ RECALL_WEBHOOK_SECRET: SECRET }));
    const body = JSON.stringify({ event: 'bot.done', data: { bot: { id: 'b' } } });
    await c.webhook({ rawBody: Buffer.from(body) } as never, sign(body));
    expect(bots.handleWebhook).toHaveBeenCalledWith({ event: 'bot.done', data: { bot: { id: 'b' } } });
    await expect(c.webhook({ rawBody: Buffer.from(body) } as never, {})).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(c.webhook({ rawBody: Buffer.from('{') } as never, sign('{'))).rejects.toThrow('Invalid JSON');
    await expect(new BotsController(bots as never, testConfig()).webhook({ rawBody: Buffer.from(body) } as never, sign(body))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(await c.send(user(), { meetingUrl: 'https://zoom.us/j/1' })).toBe('sent');
    expect(await c.leave(user(), meeting().id)).toBe('left');
  });
});

describe('BotImportService', () => {
  const transcriptJson = JSON.stringify([{ participant: { id: 1, name: 'Dana' }, language_code: 'de-DE', words: [word('Hallo', 0, 1)] }]);
  function setup() {
    const m = meeting({ botId: 'b', status: 'recording', attempts: 0 });
    const meetings = { findById: vi.fn().mockResolvedValue(m), update: vi.fn(), startRun: vi.fn().mockResolvedValue({ ...m, status: 'summarizing', attempts: 1 }), transition: vi.fn() };
    const transcripts = { store: vi.fn().mockResolvedValue(m) };
    const storage = { putBytes: vi.fn() };
    const recall = {
      getBot: vi.fn().mockResolvedValue({
        id: 'b',
        recordings: [{ id: 'r', started_at: '2026-10-06T10:00:00Z', completed_at: '2026-10-06T10:30:00Z', media_shortcuts: { transcript: { status: { code: 'done' }, data: { download_url: 'https://dl/t.json' } } } }],
      }),
      download: vi.fn(async (url: string) => (url.endsWith('.json') ? Buffer.from(transcriptJson) : new Uint8Array([9]))),
      audioMixedUrl: vi.fn().mockResolvedValue('https://dl/a.mp3'),
    };
    const jobs = { summarize: vi.fn() };
    const service = new BotImportService(meetings as never, transcripts as never, storage as never, recall as never, jobs as never);
    return { m, meetings, transcripts, storage, recall, jobs, service };
  }

  it('stores the transcript and audio, then queues the summary', async () => {
    const t = setup();
    await expect(t.service.import({ meetingId: t.m.id, run: 0 })).resolves.toBe('done');
    expect(t.transcripts.store).toHaveBeenCalledWith(t.m, { segments: [{ speaker: 'Dana', startMs: 0, endMs: 1000, text: 'Hallo' }], language: 'de', durationSec: 1800 });
    expect(t.storage.putBytes).toHaveBeenCalledWith(`users/${t.m.userId}/meetings/${t.m.id}/audio.mp3`, new Uint8Array([9]), 'audio/mpeg');
    expect(t.meetings.update).toHaveBeenCalledWith(t.m.id, expect.objectContaining({ hasAudio: true }));
    expect(t.jobs.summarize).toHaveBeenCalledWith(t.m.id, 1);
  });

  it('still summarizes when the audio can’t be fetched', async () => {
    const t = setup();
    t.recall.audioMixedUrl.mockRejectedValue(new Error('500'));
    await t.service.import({ meetingId: t.m.id, run: 0 });
    expect(t.meetings.update).not.toHaveBeenCalled();
    expect(t.jobs.summarize).toHaveBeenCalled();
  });

  it('waits for the transcript, gives up on failures, and skips stale runs', async () => {
    const t = setup();
    t.recall.getBot.mockResolvedValueOnce({ id: 'b', recordings: [{ id: 'r', media_shortcuts: { transcript: { status: { code: 'processing' }, data: {} } } }] });
    await expect(t.service.import({ meetingId: t.m.id, run: 0 })).rejects.toBeInstanceOf(NotReadyYet);
    t.recall.getBot.mockResolvedValueOnce({ id: 'b', recordings: [{ id: 'r', media_shortcuts: { transcript: { status: { code: 'failed' } } } }] });
    await expect(t.service.import({ meetingId: t.m.id, run: 0 })).rejects.toBeInstanceOf(UnrecoverableError);
    t.recall.getBot.mockResolvedValueOnce({ id: 'b', recordings: [] });
    await expect(t.service.import({ meetingId: t.m.id, run: 0 })).rejects.toThrow('didn’t record anything');
    t.recall.download.mockResolvedValueOnce(Buffer.from('[]'));
    await expect(t.service.import({ meetingId: t.m.id, run: 0 })).rejects.toThrow('Nobody spoke');
    await expect(t.service.import({ meetingId: t.m.id, run: 5 })).resolves.toBe('stale');
  });

  it('marks the meeting failed with a reason when out of retries', async () => {
    const t = setup();
    await t.service.fail({ meetingId: t.m.id, run: 0 }, new NotReadyYet('x'));
    expect(t.meetings.transition).toHaveBeenCalledWith(t.m.id, 'recording', { status: 'failed', error: 'The meeting bot’s transcript never arrived' });
    await t.service.fail({ meetingId: t.m.id, run: 3 }, new Error('x'));
    expect(t.meetings.transition).toHaveBeenCalledTimes(1);
  });
});
