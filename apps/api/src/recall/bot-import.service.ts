import { Injectable, Logger } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import { MeetingsRepository } from '../meetings/meetings.repository';
import { TranscriptService } from '../meetings/transcript.service';
import { JobsService } from '../queues/jobs.service';
import type { MeetingJob } from '../queues/queues';
import { audioKey } from '../storage/keys';
import { StorageService } from '../storage/storage.service';
import { RecallClient, type RecallTranscriptEntry } from './recall.client';
import { recallLanguage, recallToSegments } from './recall-transcript';

/** Thrown while Recall is still preparing the transcript; the job retries a minute later. */
export class NotReadyYet extends Error {}

/** Worker side: turns a finished bot's recording into the meeting's transcript and audio, then summarizes it. */
@Injectable()
export class BotImportService {
  private readonly logger = new Logger(BotImportService.name);

  constructor(
    private readonly meetings: MeetingsRepository,
    private readonly transcripts: TranscriptService,
    private readonly storage: StorageService,
    private readonly recall: RecallClient,
    private readonly jobs: JobsService,
  ) {}

  async import(job: MeetingJob): Promise<'done' | 'stale'> {
    const meeting = await this.meetings.findById(job.meetingId);
    if (!meeting?.botId || meeting.status !== 'recording' || meeting.attempts !== job.run) return 'stale';

    const bot = await this.recall.getBot(meeting.botId);
    const recording = bot.recordings?.[0];
    if (!recording) throw new UnrecoverableError('The bot didn’t record anything');
    const transcript = recording.media_shortcuts?.transcript;
    if (transcript?.status?.code === 'failed') throw new UnrecoverableError('The meeting bot’s transcription failed');
    const url = transcript?.data?.download_url;
    if (!url) throw new NotReadyYet('The transcript isn’t ready yet');

    const entries = JSON.parse(Buffer.from(await this.recall.download(url)).toString('utf8')) as RecallTranscriptEntry[];
    const segments = recallToSegments(entries);
    if (segments.length === 0) throw new UnrecoverableError('Nobody spoke while the bot was in the call');

    // The audio is a nice-to-have for playback: a meeting without it is still worth summarizing.
    let audio: { audioKey: string; audioContentType: string; hasAudio: boolean } | null = null;
    try {
      const audioUrl = await this.recall.audioMixedUrl(recording.id);
      if (audioUrl) {
        const key = audioKey(meeting.userId, meeting.id, 'audio/mpeg');
        await this.storage.putBytes(key, await this.recall.download(audioUrl), 'audio/mpeg');
        audio = { audioKey: key, audioContentType: 'audio/mpeg', hasAudio: true };
      }
    } catch (err) {
      this.logger.warn({ meetingId: meeting.id, err: (err as Error).message }, 'bot audio not imported');
    }
    if (audio) await this.meetings.update(meeting.id, audio);

    const durationSec = recording.started_at && recording.completed_at ? Math.round((Date.parse(recording.completed_at) - Date.parse(recording.started_at)) / 1000) : null;
    const stored = await this.transcripts.store(meeting, { segments, language: recallLanguage(entries) ?? meeting.language, durationSec });
    const next = await this.meetings.startRun(stored.id, 'recording', 'summarizing');
    if (next) await this.jobs.summarize(next.id, next.attempts);
    this.logger.log({ meetingId: meeting.id, segments: segments.length, audio: !!audio }, 'bot recording imported');
    return 'done';
  }

  /** Out of retries: the meeting shows why instead of waiting forever. */
  async fail(job: MeetingJob, error: Error): Promise<void> {
    const meeting = await this.meetings.findById(job.meetingId);
    if (!meeting || meeting.status !== 'recording' || meeting.attempts !== job.run) return;
    const message = error instanceof NotReadyYet ? 'The meeting bot’s transcript never arrived' : error.message;
    await this.meetings.transition(meeting.id, 'recording', { status: 'failed', error: message.slice(0, 500) });
  }
}
