import { Injectable, Logger } from '@nestjs/common';
import { speakerName, speakersOf } from '@boringtalks/shared';
import { UnrecoverableError } from 'bullmq';
import type { MeetingRow } from '../db/schema';
import { MeetingsRepository } from '../meetings/meetings.repository';
import { TranscriptService } from '../meetings/transcript.service';
import { JobsService } from '../queues/jobs.service';
import type { MeetingJob } from '../queues/queues';
import { summaryKey } from '../storage/keys';
import { StorageService } from '../storage/storage.service';
import { UsersRepository } from '../users/users.repository';
import { displayNames, resolveSpeakerNames } from './speaker-names';
import { Diarizer } from './diarizer';
import { Summarizer } from './summarizer';
import { Transcriber } from './transcriber';

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
  ) {}

  async transcribe(job: MeetingJob): Promise<'done' | 'stale'> {
    const meeting = await this.current(job, 'transcribing');
    if (!meeting) return 'stale';
    if (!meeting.audioKey) throw new UnrecoverableError('The meeting has no audio');
    const audio = await this.storage.getBytes(meeting.audioKey);
    const result = await this.transcriber.transcribe({
      audio,
      mediaType: meeting.audioContentType ?? 'audio/mp4',
      language: meeting.language,
    });
    if (result.segments.length === 0) throw new UnrecoverableError('No speech was found in the audio');
    // A model that doesn't tell voices apart gives one; then listen again to tell the people apart.
    const segments = result.diarized ? result.segments : await this.diarizer.diarize({ audio, segments: result.segments });
    await this.transcripts.store(meeting, { ...result, segments });
    const next = await this.meetings.transition(meeting.id, 'transcribing', { status: 'summarizing' });
    if (next) await this.jobs.summarize(next.id, next.attempts);
    return 'done';
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
    await this.meetings.saveSummary(
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

    if (user?.emailOnReady) {
      await this.jobs.email({ type: 'meeting-ready', userId: user.id, meetingId: meeting.id, run: job.run });
    }
    return 'done';
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
