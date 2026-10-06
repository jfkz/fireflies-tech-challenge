import { BadRequestException, ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { encodeCursor } from '../common/cursor';
import type { SummaryWithItems } from './meetings.repository';
import { meeting, seg, user } from '../testing/fixtures';
import { defaultTitle, toDetail } from './meeting.mapper';
import { MeetingsController } from './meetings.controller';
import { canStart, MeetingsService } from './meetings.service';
import { TranscriptService } from './transcript.service';

const summaryRow = (o: Partial<SummaryWithItems> = {}): SummaryWithItems => ({
  meetingId: meeting().id,
  summary: 'Summary.',
  keyTopics: ['a'],
  actionItems: [{ id: 'a1', text: 'Do it', owner: 'You', due: null, dueDate: null, done: false }],
  decisions: ['d'],
  model: 'm',
  inputTokens: 1,
  outputTokens: 1,
  createdAt: new Date(),
  ...o,
});

function setup() {
  const repo = {
    list: vi.fn(),
    create: vi.fn(),
    createOnce: vi.fn(),
    findByClientKey: vi.fn(),
    findOwned: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    hasSegments: vi.fn(),
    startRun: vi.fn(),
    getSummary: vi.fn().mockResolvedValue(null),
    getSegments: vi.fn().mockResolvedValue([]),
    setActionItemDone: vi.fn(),
    replaceTranscript: vi.fn(),
    facets: vi.fn(),
    speakerLabels: vi.fn(),
    saveSpeakerNames: vi.fn(),
    dailyStats: vi.fn(),
  };
  const storage = {
    presignPut: vi.fn().mockResolvedValue('https://r2/put'),
    presignGet: vi.fn().mockResolvedValue('https://r2/get'),
    head: vi.fn().mockResolvedValue(null),
    deletePrefix: vi.fn(),
    putJson: vi.fn(),
  };
  const jobs = { summarize: vi.fn(), transcribe: vi.fn() };
  const transcripts = new TranscriptService(repo as never, storage as never);
  const service = new MeetingsService(repo as never, transcripts, storage as never, jobs as never);
  return { repo, storage, jobs, service };
}

describe('mapper', () => {
  it('names new meetings after their start time (UTC)', () => {
    expect(defaultTitle(new Date('2026-10-06T14:05:00Z'))).toBe('Meeting on Oct 6, 14:05');
  });

  it('builds the detail shape', () => {
    const d = toDetail(meeting({ hasAudio: true }), summaryRow(), [seg('You', 0, 1, 'hi')], 'https://a');
    expect(d).toMatchObject({ actionItemCount: 1, audioUrl: 'https://a', summary: { model: 'm', decisions: ['d'] } });
    expect(d.summary).not.toHaveProperty('title');
  });
});

describe('canStart', () => {
  it('follows the shared status machine, also through "uploaded"', () => {
    expect(canStart('recording', 'summarizing')).toBe(true);
    expect(canStart('recording', 'transcribing')).toBe(true);
    expect(canStart('failed', 'transcribing')).toBe(true);
    expect(canStart('ready', 'summarizing')).toBe(true);
    expect(canStart('ready', 'transcribing')).toBe(true);
    expect(canStart('ready', 'recording' as never)).toBe(false);
    expect(canStart('summarizing', 'summarizing')).toBe(false);
    expect(canStart('transcribing', 'transcribing')).toBe(false);
  });
});

describe('MeetingsService', () => {
  it('creates a recording meeting with a placeholder title', async () => {
    const { repo, service } = setup();
    repo.create.mockImplementation((v: object) => Promise.resolve(meeting(v)));
    const { meeting: d, created } = await service.create(user(), { source: 'browser', startedAt: '2026-10-06T14:05:00Z' });
    expect(created).toBe(true);
    expect(d).toMatchObject({ title: 'Meeting on Oct 6, 14:05', status: 'recording', source: 'browser', segments: [] });
    expect(repo.create.mock.calls[0][0].titleLocked).toBe(false);
    await service.create(user(), { source: 'macos', title: 'Board call' });
    expect(repo.create.mock.calls[1][0]).toMatchObject({ title: 'Board call', titleLocked: true });
  });

  describe('create with an idempotency key', () => {
    it('creates once and returns the same meeting for a repeated key', async () => {
      const { repo, service } = setup();
      repo.findByClientKey.mockResolvedValueOnce(null).mockResolvedValueOnce(meeting({ clientKey: 'k1' }));
      repo.createOnce.mockImplementation((v: object) => Promise.resolve(meeting(v)));
      const first = await service.create(user(), { source: 'macos' }, 'k1');
      expect(first.created).toBe(true);
      expect(repo.createOnce.mock.calls[0][0]).toMatchObject({ clientKey: 'k1', userId: user().id });
      const again = await service.create(user(), { source: 'macos' }, 'k1');
      expect(again).toMatchObject({ created: false, meeting: { id: meeting().id } });
      expect(repo.createOnce).toHaveBeenCalledTimes(1);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('returns the winner when a parallel request inserted first', async () => {
      const { repo, service } = setup();
      repo.findByClientKey.mockResolvedValueOnce(null).mockResolvedValueOnce(meeting({ clientKey: 'k2' }));
      repo.createOnce.mockResolvedValue(null);
      await expect(service.create(user(), { source: 'macos' }, 'k2')).resolves.toMatchObject({ created: false });
      repo.findByClientKey.mockResolvedValue(null);
      await expect(service.create(user(), { source: 'macos' }, 'k2')).rejects.toBeInstanceOf(ConflictException);
    });
  });

  it('hides other users’ meetings', async () => {
    const { repo, service } = setup();
    repo.findOwned.mockResolvedValue(null);
    await expect(service.get(user(), meeting().id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('presigns audio only when it exists', async () => {
    const { repo, storage, service } = setup();
    repo.findOwned.mockResolvedValue(meeting({ hasAudio: true, audioKey: 'k' }));
    expect((await service.get(user(), meeting().id)).audioUrl).toBe('https://r2/get');
    repo.findOwned.mockResolvedValue(meeting({ audioKey: 'k' }));
    expect((await service.get(user(), meeting().id)).audioUrl).toBeNull();
    expect(storage.presignGet).toHaveBeenCalledTimes(1);
  });

  describe('list', () => {
    it('returns a next cursor only when there is another page', async () => {
      const { repo, service } = setup();
      const rows = [1, 2, 3].map((i) => ({ ...meeting({ id: `00000000-0000-4000-8000-00000000000${i}` }), actionItemCount: i }));
      repo.list.mockResolvedValue(rows);
      const page = await service.list(user(), { limit: 2 });
      expect(page.items.map((i) => i.actionItemCount)).toEqual([1, 2]);
      expect(page.nextCursor).toBe(encodeCursor({ startedAt: rows[1].startedAt, id: rows[1].id }));
      expect(repo.list).toHaveBeenCalledWith(user().id, { cursor: null, limit: 3, q: undefined });
      expect(page.items[0].topics).toEqual([]);

      repo.list.mockResolvedValue(rows.slice(0, 1));
      expect((await service.list(user(), { limit: 2, q: 'x', cursor: page.nextCursor! })).nextCursor).toBeNull();
      expect(repo.list.mock.calls[1][1]).toMatchObject({ q: 'x', cursor: { id: rows[1].id } });
    });

    it('passes speaker, topic and date filters through', async () => {
      const { repo, service } = setup();
      repo.list.mockResolvedValue([]);
      await service.list(user(), { limit: 5, speaker: 'Maya', topic: 'Pricing', from: '2026-10-01T00:00:00+02:00', to: '2026-10-02T00:00:00Z' });
      expect(repo.list.mock.calls[0][1]).toMatchObject({
        speaker: 'Maya',
        topic: 'Pricing',
        from: new Date('2026-09-30T22:00:00Z'),
        to: new Date('2026-10-02T00:00:00Z'),
      });
    });

    it('counts meetings per day in a valid time zone only', async () => {
      const { repo, service } = setup();
      repo.dailyStats.mockResolvedValue([{ date: '2026-10-01', count: 2, totalSec: 3600 }]);
      await expect(service.stats(user(), { from: '2026-10-01', to: '2026-11-01', tz: 'Europe/Berlin' })).resolves.toEqual({
        tz: 'Europe/Berlin',
        days: [{ date: '2026-10-01', count: 2, totalSec: 3600 }],
      });
      expect(repo.dailyStats).toHaveBeenCalledWith(user().id, '2026-10-01', '2026-11-01', 'Europe/Berlin');
      await expect(service.stats(user(), { from: '2026-10-01', to: '2026-11-01', tz: 'Mars/Olympus' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.stats(user(), { from: '2026-10-01', to: '2026-11-01', tz: "UTC'; drop" })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('offers the most frequent speakers and topics as filters', async () => {
      const { repo, service } = setup();
      repo.facets.mockResolvedValue({ speakers: [{ value: 'Maya', count: 2 }], topics: [] });
      await expect(service.facets(user())).resolves.toEqual({ speakers: [{ value: 'Maya', count: 2 }], topics: [] });
      expect(repo.facets).toHaveBeenCalledWith(user().id, 24);
    });

    it('rejects a forged cursor', async () => {
      const { service } = setup();
      await expect(service.list(user(), { limit: 2, cursor: 'nope' })).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  it('renames (locking the title) and toggles action items', async () => {
    const { repo, service } = setup();
    repo.findOwned.mockResolvedValue(meeting());
    repo.update.mockResolvedValue(meeting({ title: 'New', titleLocked: true }));
    repo.setActionItemDone.mockResolvedValue(true);
    const d = await service.update(user(), meeting().id, { title: 'New', actionItem: { id: 'a1', done: true } });
    expect(d.title).toBe('New');
    expect(repo.update).toHaveBeenCalledWith(meeting().id, { title: 'New', titleLocked: true });
    expect(repo.setActionItemDone).toHaveBeenCalledWith(meeting().id, 'a1', true);
    repo.setActionItemDone.mockResolvedValue(false);
    await expect(service.update(user(), meeting().id, { actionItem: { id: 'zz', done: true } })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('renames speakers by their display name, and 404s for an unknown one', async () => {
    const { repo, service } = setup();
    const m = meeting({ speakerNames: { 'Speaker 1': { name: 'Maya', by: 'ai' } }, speakers: ['You', 'Maya'] });
    repo.findOwned.mockResolvedValue(m);
    repo.speakerLabels.mockResolvedValue(['You', 'Speaker 1']);
    repo.saveSpeakerNames.mockImplementation(async (_id, map, speakers) => ({ ...m, speakerNames: map, speakers }));
    repo.getSegments.mockResolvedValue([seg('Speaker 1', 0, 1, 'hi')]);
    const d = await service.update(user(), m.id, { speakers: { Maya: 'Mia', You: 'Mia' } });
    expect(repo.saveSpeakerNames).toHaveBeenCalledWith(
      m.id,
      { 'Speaker 1': { name: 'Mia', by: 'user' }, You: { name: 'Mia', by: 'user' } },
      ['Mia'],
      [
        ['Maya', 'Mia'],
        ['You', 'Mia'],
      ],
    );
    expect(d.speakers).toEqual(['Mia']);
    expect(d.segments[0].speaker).toBe('Mia');
    await expect(service.update(user(), m.id, { speakers: { Nobody: 'X' } })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deletes storage objects with the meeting', async () => {
    const { repo, storage, service } = setup();
    repo.findOwned.mockResolvedValue(meeting());
    await service.remove(user(), meeting().id);
    expect(storage.deletePrefix).toHaveBeenCalledWith(`users/${user().id}/meetings/${meeting().id}/`);
    expect(repo.delete).toHaveBeenCalledWith(meeting().id);
  });

  it('presigns uploads under the meeting prefix', async () => {
    const { repo, service } = setup();
    repo.findOwned.mockResolvedValue(meeting());
    const res = await service.uploadUrl(user(), meeting().id, { contentType: 'audio/webm', sizeBytes: 1000 });
    expect(res).toEqual({
      url: 'https://r2/put',
      key: `users/${user().id}/meetings/${meeting().id}/audio.webm`,
      headers: { 'Content-Type': 'audio/webm' },
      expiresInSec: 900,
    });
    expect(repo.update).toHaveBeenCalledWith(meeting().id, { audioKey: res.key, audioContentType: 'audio/webm', hasAudio: false });
    repo.findOwned.mockResolvedValue(meeting({ status: 'summarizing' }));
    await expect(service.uploadUrl(user(), meeting().id, { contentType: 'audio/webm', sizeBytes: 1 })).rejects.toBeInstanceOf(ConflictException);
  });

  it('stores transcripts in R2 and Postgres', async () => {
    const { repo, storage, service } = setup();
    repo.findOwned.mockResolvedValue(meeting());
    const segments = [seg('You', 0, 1000, 'Hi'), seg('Speaker 1', 1000, 4200, 'Hello')];
    await service.putTranscript(user(), meeting().id, { segments, language: 'en' });
    expect(storage.putJson).toHaveBeenCalledWith(`users/${user().id}/meetings/${meeting().id}/transcript.json`, {
      meetingId: meeting().id,
      segments,
      language: 'en',
    });
    expect(repo.replaceTranscript).toHaveBeenCalledWith(meeting().id, segments, {
      transcriptKey: expect.stringContaining('transcript.json'),
      speakers: ['You', 'Speaker 1'],
      language: 'en',
      durationSec: 5,
    });
    repo.findOwned.mockResolvedValue(meeting({ status: 'transcribing' }));
    await expect(service.putTranscript(user(), meeting().id, { segments })).rejects.toBeInstanceOf(ConflictException);
  });

  describe('complete', () => {
    it('summarizes when there is a transcript', async () => {
      const { repo, storage, jobs, service } = setup();
      repo.findOwned.mockResolvedValue(meeting({ audioKey: 'a' }));
      repo.hasSegments.mockResolvedValue(true);
      storage.head.mockResolvedValue({ size: 10, contentType: 'audio/mp4' });
      repo.startRun.mockResolvedValue(meeting({ status: 'summarizing', attempts: 1 }));
      const d = await service.complete(user(), meeting().id, { durationSec: 42 });
      expect(d.status).toBe('summarizing');
      expect(repo.startRun).toHaveBeenCalledWith(meeting().id, 'recording', 'summarizing', { hasAudio: true, durationSec: 42 });
      expect(jobs.summarize).toHaveBeenCalledWith(meeting().id, 1);
    });

    it('transcribes when there is only audio', async () => {
      const { repo, storage, jobs, service } = setup();
      repo.findOwned.mockResolvedValue(meeting({ audioKey: 'a' }));
      repo.hasSegments.mockResolvedValue(false);
      storage.head.mockResolvedValue({ size: 10, contentType: 'audio/webm' });
      repo.startRun.mockResolvedValue(meeting({ status: 'transcribing', attempts: 1 }));
      await service.complete(user(), meeting().id, {});
      expect(repo.startRun).toHaveBeenCalledWith(meeting().id, 'recording', 'transcribing', { hasAudio: true });
      expect(jobs.transcribe).toHaveBeenCalledWith(meeting().id, 1);
    });

    it('needs a transcript or uploaded audio', async () => {
      const { repo, service } = setup();
      repo.findOwned.mockResolvedValue(meeting({ audioKey: 'a' }));
      repo.hasSegments.mockResolvedValue(false);
      await expect(service.complete(user(), meeting().id, {})).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('refuses an already completed meeting and lost races with 409', async () => {
      const { repo, service } = setup();
      repo.hasSegments.mockResolvedValue(true);
      for (const status of ['transcribing', 'summarizing', 'ready'] as const) {
        repo.findOwned.mockResolvedValue(meeting({ status }));
        await expect(service.complete(user(), meeting().id, {})).rejects.toBeInstanceOf(ConflictException);
      }
      expect(repo.startRun).not.toHaveBeenCalled();
      repo.findOwned.mockResolvedValue(meeting({ status: 'failed', attempts: 1 }));
      repo.startRun.mockResolvedValueOnce(meeting({ status: 'summarizing', attempts: 2 }));
      await expect(service.complete(user(), meeting().id, {})).resolves.toMatchObject({ status: 'summarizing' });
      repo.findOwned.mockResolvedValue(meeting());
      repo.startRun.mockResolvedValue(null);
      await expect(service.complete(user(), meeting().id, {})).rejects.toBeInstanceOf(ConflictException);
    });
  });

  it('reprocesses a server-transcribed meeting from its audio, so voices are told apart', async () => {
    const { repo, storage, jobs, service } = setup();
    repo.findOwned.mockResolvedValue(meeting({ status: 'ready', attempts: 1, source: 'upload', audioKey: 'a.mp3' }));
    repo.hasSegments.mockResolvedValue(true);
    storage.head.mockResolvedValue({ size: 10 });
    repo.startRun.mockResolvedValue(meeting({ status: 'transcribing', attempts: 2 }));
    await service.reprocess(user(), meeting().id);
    expect(repo.startRun).toHaveBeenCalledWith(meeting().id, 'ready', 'transcribing', expect.anything());
    expect(jobs.transcribe).toHaveBeenCalledWith(meeting().id, 2);
  });

  it('reprocesses a ready meeting from its summary', async () => {
    const { repo, jobs, service } = setup();
    repo.findOwned.mockResolvedValue(meeting({ status: 'ready', attempts: 1 }));
    repo.hasSegments.mockResolvedValue(true);
    repo.startRun.mockResolvedValue(meeting({ status: 'summarizing', attempts: 2 }));
    await service.reprocess(user(), meeting().id);
    expect(jobs.summarize).toHaveBeenCalledWith(meeting().id, 2);
  });
});

describe('MeetingsController', () => {
  it('delegates every route to the service', async () => {
    const s = {
      list: vi.fn(() => 'list'),
      create: vi.fn(() => 'create'),
      get: vi.fn(() => 'get'),
      update: vi.fn(() => 'update'),
      remove: vi.fn(),
      uploadUrl: vi.fn(() => 'upload'),
      putTranscript: vi.fn(),
      complete: vi.fn(() => 'complete'),
      reprocess: vi.fn(() => 'reprocess'),
      facets: vi.fn(() => 'facets'),
      stats: vi.fn(() => 'stats'),
    };
    const c = new MeetingsController(s as never);
    const u = user();
    const id = meeting().id;
    expect(await c.list(u, { limit: 20 })).toBe('list');
    expect(await c.facets(u)).toBe('facets');
    expect(await c.stats(u, { from: '2026-10-01', to: '2026-10-02', tz: 'UTC' })).toBe('stats');
    s.create.mockReturnValueOnce({ meeting: 'new', created: true } as never).mockReturnValueOnce({ meeting: 'old', created: false } as never);
    const res = { status: vi.fn() };
    expect(await c.create(u, { source: 'macos' }, undefined, res as never)).toBe('new');
    expect(res.status).toHaveBeenLastCalledWith(201);
    expect(await c.create(u, { source: 'macos' }, 'key-1', res as never)).toBe('old');
    expect(res.status).toHaveBeenLastCalledWith(200);
    expect(s.create).toHaveBeenLastCalledWith(u, { source: 'macos' }, 'key-1');
    expect(await c.get(u, id)).toBe('get');
    expect(await c.update(u, id, { title: 'x' })).toBe('update');
    await c.remove(u, id);
    expect(await c.uploadUrl(u, id, { contentType: 'audio/mp4', sizeBytes: 1 })).toBe('upload');
    await c.putTranscript(u, id, { segments: [seg('You', 0, 1, 'x')] });
    expect(await c.complete(u, id, {})).toBe('complete');
    expect(await c.reprocess(u, id)).toBe('reprocess');
    expect(s.remove).toHaveBeenCalledWith(u, id);
    expect(s.putTranscript).toHaveBeenCalled();
  });
});
