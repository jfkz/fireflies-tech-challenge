import { UnrecoverableError, type Job } from 'bullmq';
import { meeting, seg, testConfig, user } from '../testing/fixtures';
import { PipelineService } from './pipeline.service';
import { isFinalFailure, SummarizeProcessor, TranscribeProcessor } from './processors';
import type { SummaryResult } from './summarizer';

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
  const meetings = { findById: vi.fn(), transition: vi.fn(), getSegments: vi.fn(), saveSummary: vi.fn(), topTopics: vi.fn().mockResolvedValue([]) };
  const transcripts = { store: vi.fn() };
  const storage = { getBytes: vi.fn().mockResolvedValue(new Uint8Array(3)), putJson: vi.fn() };
  const users = { findById: vi.fn().mockResolvedValue(user()) };
  const jobs = { summarize: vi.fn(), email: vi.fn() };
  const transcriber = { transcribe: vi.fn() };
  const summarizer = { summarize: vi.fn().mockResolvedValue(result) };
  const pipeline = new PipelineService(
    meetings as never,
    transcripts as never,
    storage as never,
    users as never,
    jobs as never,
    transcriber as never,
    summarizer as never,
  );
  return { meetings, transcripts, storage, users, jobs, transcriber, summarizer, pipeline };
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
    expect(t.jobs.summarize).toHaveBeenCalledWith(m.id, 2);
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
