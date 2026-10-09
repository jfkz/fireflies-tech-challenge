import type { Segment } from '@boringtalks/shared';
import { UnrecoverableError, type Job } from 'bullmq';
import { splitChannels } from './audio-prep';
import { meeting, seg, testConfig, user } from '../testing/fixtures';
import { PipelineService } from './pipeline.service';
import { isFinalFailure, SummarizeProcessor, TranscribeProcessor } from './processors';
import type { SummaryResult } from './summarizer';

vi.mock('./audio-prep', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./audio-prep')>()),
  splitChannels: vi.fn(),
}));

const result: SummaryResult = {
  title: 'Specific title',
  description: 'One sentence.',
  summary: 'Summary.',
  keyTopics: ['a'],
  topics: ['A'],
  speakers: [],
  actionItems: [],
  decisions: [],
  model: 'm',
  inputTokens: 5,
  outputTokens: 2,
};

function setup() {
  const meetings = {
    findById: vi.fn(),
    transition: vi.fn(),
    getSegments: vi.fn(),
    update: vi.fn(),
    saveSummary: vi.fn().mockImplementation(async (id: string) => meeting({ id, status: 'ready' })),
    topTopics: vi.fn().mockResolvedValue([]),
    chainCandidates: vi.fn().mockResolvedValue([]),
    joinChain: vi.fn(),
  };
  const transcripts = { store: vi.fn() };
  const storage = { getBytes: vi.fn().mockResolvedValue(new Uint8Array(3)), putJson: vi.fn(), putBytes: vi.fn() };
  const users = { findById: vi.fn().mockResolvedValue(user()) };
  const jobs = { summarize: vi.fn(), email: vi.fn() };
  const transcriber = { transcribe: vi.fn() };
  const summarizer = { summarize: vi.fn().mockResolvedValue(result) };
  const diarizer = { diarize: vi.fn(async ({ segments }: { audio: Uint8Array; segments: Segment[] }) => segments) };
  const chains = { link: vi.fn().mockResolvedValue(null) };
  const pipeline = new PipelineService(
    meetings as never,
    transcripts as never,
    storage as never,
    users as never,
    jobs as never,
    transcriber as never,
    summarizer as never,
    diarizer as never,
    chains as never,
  );
  return { meetings, transcripts, storage, users, jobs, transcriber, summarizer, diarizer, chains, pipeline };
}

describe('PipelineService.transcribe', () => {
  it('transcribes the audio, stores it and queues the summary', async () => {
    const t = setup();
    const m = meeting({ status: 'transcribing', attempts: 2, audioKey: 'a.webm', audioContentType: 'audio/webm' });
    t.meetings.findById.mockResolvedValue(m);
    t.transcriber.transcribe.mockResolvedValue({ segments: [seg('Speaker 1', 0, 1, 'hi')], language: 'en', durationSec: 1 });
    t.meetings.transition.mockResolvedValue({ ...m, status: 'summarizing' });
    await expect(t.pipeline.transcribe({ meetingId: m.id, run: 2 })).resolves.toBe('done');
    expect(t.transcriber.transcribe).toHaveBeenCalledWith({ audio: new Uint8Array(3), mediaType: 'audio/webm', language: null });
    expect(t.transcripts.store).toHaveBeenCalledWith(m, expect.objectContaining({ language: 'en' }));
    expect(t.meetings.transition).toHaveBeenCalledWith(m.id, 'transcribing', { status: 'summarizing' });
    expect(t.diarizer.diarize).toHaveBeenCalledWith({ audio: new Uint8Array(3), segments: [seg('Speaker 1', 0, 1, 'hi')] });
    expect(t.jobs.summarize).toHaveBeenCalledWith(m.id, 2);
  });

  it('stores the transcript with the voices told apart', async () => {
    const t = setup();
    const m = meeting({ status: 'transcribing', attempts: 1, audioKey: 'a.webm' });
    t.meetings.findById.mockResolvedValue(m);
    t.transcriber.transcribe.mockResolvedValue({ segments: [seg('Speaker 1', 0, 1, 'hi'), seg('Speaker 1', 1, 2, 'hello')], language: 'en', durationSec: 2 });
    t.diarizer.diarize.mockResolvedValueOnce([seg('Speaker 1', 0, 1, 'hi'), seg('Speaker 2', 1, 2, 'hello')]);
    await t.pipeline.transcribe({ meetingId: m.id, run: 1 });
    expect(t.transcripts.store.mock.calls[0][1].segments.map((s: { speaker: string }) => s.speaker)).toEqual(['Speaker 1', 'Speaker 2']);
  });

  it('keeps the speakers of a model that told them apart itself', async () => {
    const t = setup();
    const m = meeting({ status: 'transcribing', attempts: 1, audioKey: 'a.m4a' });
    t.meetings.findById.mockResolvedValue(m);
    const segments = [seg('Speaker 1', 0, 1, 'hi'), seg('Speaker 2', 1, 2, 'hello')];
    t.transcriber.transcribe.mockResolvedValue({ segments, language: 'en', durationSec: 2, diarized: true });
    await t.pipeline.transcribe({ meetingId: m.id, run: 1 });
    expect(t.diarizer.diarize).not.toHaveBeenCalled();
    expect(t.transcripts.store.mock.calls[0][1].segments).toEqual(segments);
  });

  it('skips stale or deleted meetings', async () => {
    const t = setup();
    t.meetings.findById.mockResolvedValueOnce(null);
    await expect(t.pipeline.transcribe({ meetingId: 'x', run: 1 })).resolves.toBe('stale');
    t.meetings.findById.mockResolvedValueOnce(meeting({ status: 'transcribing', attempts: 3 }));
    await expect(t.pipeline.transcribe({ meetingId: 'x', run: 2 })).resolves.toBe('stale');
    expect(t.transcriber.transcribe).not.toHaveBeenCalled();
  });

  it('gives up at once on meetings without audio or speech', async () => {
    const t = setup();
    t.meetings.findById.mockResolvedValue(meeting({ status: 'transcribing', attempts: 1 }));
    await expect(t.pipeline.transcribe({ meetingId: 'x', run: 1 })).rejects.toBeInstanceOf(UnrecoverableError);
    t.meetings.findById.mockResolvedValue(meeting({ status: 'transcribing', attempts: 1, audioKey: 'a' }));
    t.transcriber.transcribe.mockResolvedValue({ segments: [], language: null, durationSec: null });
    await expect(t.pipeline.transcribe({ meetingId: 'x', run: 1 })).rejects.toThrow('No speech');
  });
});

describe('PipelineService.transcribe: microphone and system audio on their own channels', () => {
  const mic = new Uint8Array([1]);
  const system = new Uint8Array([2, 2]);
  const mix = new Uint8Array([3, 3, 3]);

  function split(t: ReturnType<typeof setup>) {
    const m = meeting({ status: 'transcribing', attempts: 1, audioKey: 'audio.m4a', audioContentType: 'audio/mp4', audioChannels: 'mic-system' });
    t.meetings.findById.mockResolvedValue(m);
    t.meetings.transition.mockResolvedValue({ ...m, status: 'summarizing' });
    vi.mocked(splitChannels).mockResolvedValue({ mic, system, mix });
    return m;
  }

  it('transcribes each side, labels the microphone You, drops its echo and keeps a mono mix to play', async () => {
    const t = setup();
    const m = split(t);
    t.transcriber.transcribe.mockImplementation(async ({ audio }: { audio: Uint8Array }) =>
      audio === mic
        ? { segments: [seg('Speaker 1', 0, 1000, 'Hello there'), seg('Speaker 1', 3000, 4000, 'we ship on Friday')], language: 'en', durationSec: 5, diarized: true }
        : { segments: [seg('Speaker 1', 3000, 4000, 'We ship on Friday'), seg('Speaker 1', 4500, 5000, 'Great')], language: 'en', durationSec: 5 },
    );
    t.diarizer.diarize.mockImplementationOnce(async ({ segments }) => segments.map((s, i) => ({ ...s, speaker: `Speaker ${i + 1}` })));
    await expect(t.pipeline.transcribe({ meetingId: m.id, run: 1 })).resolves.toBe('done');

    expect(t.transcriber.transcribe).toHaveBeenCalledWith({ audio: mic, mediaType: 'audio/mpeg', language: null });
    expect(t.transcriber.transcribe).toHaveBeenCalledWith({ audio: system, mediaType: 'audio/mpeg', language: null });
    // Only the others' side is listened to again for voices.
    expect(t.diarizer.diarize).toHaveBeenCalledTimes(1);
    expect(t.diarizer.diarize.mock.calls[0][0].audio).toBe(system);
    expect(t.transcripts.store.mock.calls[0][1].segments).toEqual([
      seg('You', 0, 1000, 'Hello there'),
      seg('Speaker 1', 3000, 4000, 'We ship on Friday'),
      seg('Speaker 2', 4500, 5000, 'Great'),
    ]);
    const key = `users/${m.userId}/meetings/${m.id}/audio-playback.m4a`;
    expect(t.storage.putBytes).toHaveBeenCalledWith(key, mix, 'audio/mp4');
    expect(t.meetings.update).toHaveBeenCalledWith(m.id, { playbackKey: key });
    expect(t.jobs.summarize).toHaveBeenCalledWith(m.id, 1);
  });

  it('is fine with one side silent, and gives up when both are', async () => {
    const t = setup();
    const m = split(t);
    t.transcriber.transcribe.mockImplementation(async ({ audio }: { audio: Uint8Array }) => ({
      segments: audio === mic ? [seg('Speaker 1', 0, 1000, 'Just me today')] : [],
      language: 'en',
      durationSec: 1,
    }));
    await t.pipeline.transcribe({ meetingId: m.id, run: 1 });
    expect(t.transcripts.store.mock.calls[0][1].segments).toEqual([seg('You', 0, 1000, 'Just me today')]);
    expect(t.diarizer.diarize).not.toHaveBeenCalled();

    t.transcriber.transcribe.mockResolvedValue({ segments: [], language: null, durationSec: null });
    await expect(t.pipeline.transcribe({ meetingId: m.id, run: 1 })).rejects.toThrow('No speech');
  });

  it('keeps the mono mix to play even when transcription fails', async () => {
    const t = setup();
    const m = split(t);
    t.transcriber.transcribe.mockRejectedValue(new Error('gateway down'));
    await expect(t.pipeline.transcribe({ meetingId: m.id, run: 1 })).rejects.toThrow('gateway down');
    expect(t.storage.putBytes).toHaveBeenCalledWith(expect.stringContaining('audio-playback.m4a'), mix, 'audio/mp4');
    expect(t.meetings.update).toHaveBeenCalledWith(m.id, { playbackKey: expect.stringContaining('audio-playback.m4a') });
  });
});

describe('PipelineService.summarize: chains', () => {
  const earlier = { id: '33333333-3333-4333-8333-333333333333', title: 'Admin page plan', description: null, startedAt: new Date('2026-10-01T10:00:00Z'), speakers: ['Gat'], topics: ['Launch'], chainId: null };

  function ready(t: ReturnType<typeof setup>, overrides = {}) {
    const m = meeting({ status: 'summarizing', attempts: 1, ...overrides });
    t.meetings.findById.mockResolvedValue(m);
    t.meetings.getSegments.mockResolvedValue([seg('You', 0, 1, 'hi')]);
    t.meetings.saveSummary.mockResolvedValue({ ...m, status: 'ready' });
    return m;
  }

  it('links a meeting that continues another one into its chain', async () => {
    const t = setup();
    const m = ready(t);
    t.meetings.chainCandidates.mockResolvedValue([earlier]);
    t.chains.link.mockResolvedValue({ meetingId: earlier.id, reason: 'Follows up on the admin page plan' });
    await t.pipeline.summarize({ meetingId: m.id, run: 1 });
    expect(t.meetings.chainCandidates).toHaveBeenCalledWith(m.userId, m.id, m.startedAt, 20);
    expect(t.chains.link).toHaveBeenCalledWith({ meeting: expect.objectContaining({ id: m.id, summary: 'Summary.' }), candidates: [earlier] });
    expect(t.meetings.joinChain).toHaveBeenCalledWith(m.id, earlier.id, { reason: 'Follows up on the admin page plan', locked: false });
  });

  it('leaves chained, hand-linked and lonely meetings alone, and never fails the meeting over it', async () => {
    const chained = setup();
    ready(chained, { chainId: '44444444-4444-4444-8444-444444444444' });
    await chained.pipeline.summarize({ meetingId: 'x', run: 1 });
    const locked = setup();
    ready(locked, { chainLocked: true });
    await locked.pipeline.summarize({ meetingId: 'x', run: 1 });
    for (const t of [chained, locked]) expect(t.meetings.chainCandidates).not.toHaveBeenCalled();

    const alone = setup();
    ready(alone);
    await alone.pipeline.summarize({ meetingId: 'x', run: 1 });
    expect(alone.chains.link).not.toHaveBeenCalled();

    const unrelated = setup();
    ready(unrelated);
    unrelated.meetings.chainCandidates.mockResolvedValue([earlier]);
    await unrelated.pipeline.summarize({ meetingId: 'x', run: 1 });
    expect(unrelated.meetings.joinChain).not.toHaveBeenCalled();

    const broken = setup();
    ready(broken);
    broken.meetings.chainCandidates.mockResolvedValue([earlier]);
    broken.chains.link.mockRejectedValue(new Error('gateway down'));
    await expect(broken.pipeline.summarize({ meetingId: 'x', run: 1 })).resolves.toBe('done');
  });
});

describe('PipelineService.summarize', () => {
  it('stores the summary, names the meeting and queues the ready email', async () => {
    const t = setup();
    const m = meeting({ status: 'summarizing', attempts: 1, language: 'de' });
    t.meetings.findById.mockResolvedValue(m);
    t.meetings.getSegments.mockResolvedValue([seg('You', 0, 1, 'hallo')]);
    await expect(t.pipeline.summarize({ meetingId: m.id, run: 1 })).resolves.toBe('done');
    expect(t.summarizer.summarize).toHaveBeenCalledWith({ segments: [seg('You', 0, 1, 'hallo')], language: 'de', ownerName: 'Ann', knownTopics: [], meetingDate: m.startedAt });
    expect(t.storage.putJson).toHaveBeenCalledWith(expect.stringMatching(/summary-.*\.json$/), expect.objectContaining({ title: 'Specific title' }));
    expect(t.meetings.saveSummary).toHaveBeenCalledWith(
      m.id,
      { summary: 'Summary.', keyTopics: ['a'], actionItems: [], decisions: [], model: 'm', inputTokens: 5, outputTokens: 2 },
      {
        status: 'ready',
        error: null,
        description: 'One sentence.',
        title: 'Specific title',
        topics: ['A'],
        speakerNames: { You: { name: 'Ann', by: 'ai' } },
        speakers: ['Ann'],
      },
    );
    expect(t.jobs.email).toHaveBeenCalledWith({ type: 'meeting-ready', userId: user().id, meetingId: m.id, run: 1 });
  });

  it('names the voices, keeps names typed by hand, and moves action item owners to the names', async () => {
    const t = setup();
    const m = meeting({ status: 'summarizing', attempts: 1, speakerNames: { 'Speaker 2': { name: 'Boss', by: 'user' } } });
    t.meetings.findById.mockResolvedValue(m);
    t.meetings.topTopics.mockResolvedValue(['Pricing']);
    t.meetings.getSegments.mockResolvedValue([seg('You', 0, 1, 'Thanks Maya'), seg('Speaker 1', 1, 2, 'Sure'), seg('Speaker 2', 2, 3, 'Go')]);
    t.summarizer.summarize.mockResolvedValue({
      ...result,
      speakers: [
        { label: 'Speaker 1', name: 'Maya', role: null },
        { label: 'Speaker 2', name: 'Leo', role: null },
      ],
      actionItems: [{ id: 'a1', text: 'Send it', owner: 'Speaker 1', due: null, done: false }],
    });
    await t.pipeline.summarize({ meetingId: m.id, run: 1 });
    expect(t.summarizer.summarize.mock.calls[0][0].knownTopics).toEqual(['Pricing']);
    const [, values, patch] = t.meetings.saveSummary.mock.calls[0];
    expect(patch.speakers).toEqual(['Ann', 'Maya', 'Boss']);
    expect(patch.speakerNames['Speaker 2']).toEqual({ name: 'Boss', by: 'user' });
    expect(values.actionItems[0].owner).toBe('Maya');
  });

  it('keeps a title the user chose and respects the email setting', async () => {
    const t = setup();
    t.meetings.findById.mockResolvedValue(meeting({ status: 'summarizing', attempts: 1, titleLocked: true }));
    t.meetings.getSegments.mockResolvedValue([seg('You', 0, 1, 'x')]);
    t.users.findById.mockResolvedValue(user({ emailOnReady: false }));
    await t.pipeline.summarize({ meetingId: 'x', run: 1 });
    expect(t.meetings.saveSummary.mock.calls[0][2]).not.toHaveProperty('title');
    expect(t.jobs.email).not.toHaveBeenCalled();
  });

  it('skips stale runs and refuses empty transcripts', async () => {
    const t = setup();
    t.meetings.findById.mockResolvedValue(meeting({ status: 'ready', attempts: 1 }));
    await expect(t.pipeline.summarize({ meetingId: 'x', run: 1 })).resolves.toBe('stale');
    t.meetings.findById.mockResolvedValue(meeting({ status: 'summarizing', attempts: 1 }));
    t.meetings.getSegments.mockResolvedValue([]);
    await expect(t.pipeline.summarize({ meetingId: 'x', run: 1 })).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('marks the current run failed with the error', async () => {
    const t = setup();
    t.meetings.findById.mockResolvedValue(meeting({ status: 'summarizing', attempts: 1 }));
    await t.pipeline.fail({ meetingId: meeting().id, run: 1 }, 'summarizing', new Error('x'.repeat(600)));
    expect(t.meetings.transition).toHaveBeenCalledWith(meeting().id, 'summarizing', { status: 'failed', error: 'x'.repeat(500) });
    t.meetings.findById.mockResolvedValue(meeting({ status: 'ready', attempts: 1 }));
    await t.pipeline.fail({ meetingId: meeting().id, run: 1 }, 'summarizing', new Error('late'));
    expect(t.meetings.transition).toHaveBeenCalledTimes(1);
  });
});

describe('processors', () => {
  const job = (attemptsMade: number, attempts = 5) => ({ data: { meetingId: 'm', run: 1 }, attemptsMade, opts: { attempts } }) as unknown as Job;

  it('fail the meeting only after the last retry or an unrecoverable error', () => {
    expect(isFinalFailure(job(1), new Error('x'))).toBe(false);
    expect(isFinalFailure(job(5), new Error('x'))).toBe(true);
    expect(isFinalFailure(job(1), new UnrecoverableError('x'))).toBe(true);
  });

  it('delegate to the pipeline and set concurrency from config', async () => {
    const pipeline = { transcribe: vi.fn(() => 'done'), summarize: vi.fn(() => 'done'), fail: vi.fn() };
    const config = testConfig({ SUMMARIZE_CONCURRENCY: '7', TRANSCRIBE_CONCURRENCY: '3' });
    const t = new TranscribeProcessor(pipeline as never, config);
    const s = new SummarizeProcessor(pipeline as never, config);
    const workers = [{ concurrency: 1 }, { concurrency: 1 }];
    Object.assign(t, { _worker: workers[0] });
    Object.assign(s, { _worker: workers[1] });
    t.onApplicationBootstrap();
    s.onApplicationBootstrap();
    expect(workers.map((w) => w.concurrency)).toEqual([3, 7]);

    expect(await t.process(job(0))).toBe('done');
    expect(await s.process(job(0))).toBe('done');
    await t.onFailed(job(1), new Error('retry'));
    await s.onFailed(undefined, new Error('?'));
    expect(pipeline.fail).not.toHaveBeenCalled();
    await t.onFailed(job(5), new Error('final'));
    await s.onFailed(job(5), new Error('final'));
    expect(pipeline.fail.mock.calls.map((c) => c[1])).toEqual(['transcribing', 'summarizing']);
  });
});
