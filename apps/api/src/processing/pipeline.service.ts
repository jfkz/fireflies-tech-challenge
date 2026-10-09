import { Injectable, Logger } from '@nestjs/common';
import { speakerName, speakersOf } from '@boringtalks/shared';
import { UnrecoverableError } from 'bullmq';
import type { MeetingRow } from '../db/schema';
import { MeetingsRepository } from '../meetings/meetings.repository';
import { TranscriptService } from '../meetings/transcript.service';
import { JobsService } from '../queues/jobs.service';
import type { MeetingJob } from '../queues/queues';
import { playbackKey, summaryKey } from '../storage/keys';
import { StorageService } from '../storage/storage.service';
import { UsersRepository } from '../users/users.repository';
import { PLAYBACK_MEDIA_TYPE, SPEECH_MEDIA_TYPE, splitChannels } from './audio-prep';
import { mergeChannels } from './channels';
import { displayNames, resolveSpeakerNames } from './speaker-names';
import { ChainLinker, linkIntoChain } from './chain-linker';
import { Diarizer } from './diarizer';
import { Summarizer } from './summarizer';
import { Transcriber, type TranscribeResult } from './transcriber';

/** How many of the user's existing topic tags the summarizer is shown, to reuse them. */
const KNOWN_TOPICS = 30;

/** Meeting processing steps run by the worker. Each step is safe to retry and ignores stale runs. */
@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name);

  constructor(
    private readonly meetings: MeetingsRepository,
    private readonly transcripts: TranscriptService,
    private readonly storage: StorageService,
    private readonly users: UsersRepository,
    private readonly jobs: JobsService,
    private readonly transcriber: Transcriber,
    private readonly summarizer: Summarizer,
    private readonly diarizer: Diarizer,
    private readonly chains: ChainLinker,
  ) {}

  async transcribe(job: MeetingJob): Promise<'done' | 'stale'> {
    const meeting = await this.current(job, 'transcribing');
    if (!meeting) return 'stale';
    if (!meeting.audioKey) throw new UnrecoverableError('The meeting has no audio');
    const audio = await this.storage.getBytes(meeting.audioKey);
    const result =
      meeting.audioChannels === 'mic-system'
        ? await this.transcribeSplit(meeting, audio)
        : await this.listen(audio, meeting.audioContentType ?? 'audio/mp4', meeting.language);
    if (result.segments.length === 0) throw new UnrecoverableError('No speech was found in the audio');
    await this.transcripts.store(meeting, result);
    const next = await this.meetings.transition(meeting.id, 'transcribing', { status: 'summarizing' });
    if (next) await this.jobs.summarize(next.id, next.attempts);
    return 'done';
  }

  /**
   * A Mac recording with the microphone and system audio on their own channels: each side is
   * transcribed by itself, the microphone as "You" and the others with their voices told apart,
   * then merged (echo dropped) like the Mac does it. The dashboard plays a mono mix of both.
   */
  private async transcribeSplit(meeting: MeetingRow, audio: Uint8Array): Promise<TranscribeResult> {
    const sides = await splitChannels(audio);
    // The one file the dashboard plays: saved first, so it is there even if transcription fails.
    const key = playbackKey(meeting.userId, meeting.id);
    await this.storage.putBytes(key, sides.mix, PLAYBACK_MEDIA_TYPE);
    await this.meetings.update(meeting.id, { playbackKey: key });
    const [mic, system] = await Promise.all([
      this.transcriber.transcribe({ audio: sides.mic, mediaType: SPEECH_MEDIA_TYPE, language: meeting.language }),
      this.listen(sides.system, SPEECH_MEDIA_TYPE, meeting.language),
    ]);
    this.logger.log({ meetingId: meeting.id, mic: mic.segments.length, system: system.segments.length }, 'transcribed both sides');
    return {
      segments: mergeChannels(mic.segments, system.segments),
      language: meeting.language ?? system.language ?? mic.language,
      durationSec: system.durationSec ?? mic.durationSec,
      diarized: true,
    };
  }

  /** Speech to text with the speakers told apart: by the model itself, or by listening again. */
  private async listen(audio: Uint8Array, mediaType: string, language: string | null): Promise<TranscribeResult> {
    const result = await this.transcriber.transcribe({ audio, mediaType, language });
    if (result.diarized || result.segments.length === 0) return result;
    return { ...result, segments: await this.diarizer.diarize({ audio, segments: result.segments }) };
  }

  async summarize(job: MeetingJob): Promise<'done' | 'stale'> {
    const meeting = await this.current(job, 'summarizing');
    if (!meeting) return 'stale';
    const segments = await this.meetings.getSegments(meeting.id);
    if (segments.length === 0) throw new UnrecoverableError('The meeting has no transcript');

    const user = await this.users.findById(meeting.userId);
    const ownerName = user?.name ?? null;
    const knownTopics = await this.meetings.topTopics(meeting.userId, KNOWN_TOPICS);
    const result = await this.summarizer.summarize({ segments, language: meeting.language, ownerName, knownTopics, meetingDate: meeting.startedAt });
    const at = new Date();
    await this.storage.putJson(summaryKey(meeting.userId, meeting.id, at), { meetingId: meeting.id, createdAt: at, ...result });

    // Put names to the voices (keeping any the user typed), then use them for owners too.
    const labels = speakersOf(segments);
    const speakerNames = resolveSpeakerNames(labels, result.speakers, ownerName, meeting.speakerNames);
    const names = displayNames(speakerNames);
    const { title, description, model, inputTokens, outputTokens, topics, speakers: _guesses, actionItems, ...rest } = result;
    const saved = await this.meetings.saveSummary(
      meeting.id,
      { ...rest, actionItems: actionItems.map((a) => ({ ...a, owner: a.owner && speakerName(a.owner, names) })), model, inputTokens, outputTokens },
      {
        status: 'ready',
        error: null,
        description,
        topics,
        speakerNames,
        speakers: [...new Set(labels.map((l) => speakerName(l, names)))],
        ...(meeting.titleLocked ? {} : { title }),
      },
    );
    this.logger.log({ meetingId: meeting.id, model, inputTokens, outputTokens, named: Object.keys(speakerNames).length }, 'meeting summarized');
    await this.linkChain(saved, result.summary);

    if (user?.emailOnReady) {
      await this.jobs.email({ type: 'meeting-ready', userId: user.id, meetingId: meeting.id, run: job.run });
    }
    return 'done';
  }

  /**
   * Links a meeting that continues another one (the same recurring meeting, a follow-up on the same
   * work) into that meeting's chain. Best effort: the meeting is ready either way.
   */
  private async linkChain(meeting: MeetingRow, summary: string): Promise<void> {
    try {
      const link = await linkIntoChain(this.meetings, this.chains, meeting, summary);
      if (link) this.logger.log({ meetingId: meeting.id, with: link.meetingId }, 'meeting linked into a chain');
    } catch (err) {
      this.logger.warn({ meetingId: meeting.id, err: (err as Error).message }, 'chain linking failed');
    }
  }

  /** Called when a job has used up its retries: the meeting shows the error instead of spinning forever. */
  async fail(job: MeetingJob, stage: 'transcribing' | 'summarizing', error: Error): Promise<void> {
    const meeting = await this.current(job, stage);
    if (!meeting) return;
    await this.meetings.transition(meeting.id, stage, { status: 'failed', error: error.message.slice(0, 500) });
    this.logger.warn({ meetingId: meeting.id, stage, err: error.message }, 'meeting processing failed');
  }

  /** The meeting, if it still exists and this job belongs to its current run and stage. */
  private async current(job: MeetingJob, stage: MeetingRow['status']): Promise<MeetingRow | null> {
    const meeting = await this.meetings.findById(job.meetingId);
    if (!meeting || meeting.status !== stage || meeting.attempts !== job.run) {
      this.logger.log({ meetingId: job.meetingId, run: job.run, stage }, 'skipping stale job');
      return null;
    }
    return meeting;
  }
}
