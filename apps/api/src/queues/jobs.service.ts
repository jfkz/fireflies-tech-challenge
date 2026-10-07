import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  BOT_IMPORT_JOB_OPTIONS,
  BOT_IMPORT_QUEUE,
  EMAIL_QUEUE,
  emailJobId,
  meetingJobId,
  SUMMARIZE_QUEUE,
  TRANSCRIBE_QUEUE,
  type EmailJob,
  type MeetingJob,
} from './queues';

/** Producer side of the pipeline; used by both the API and the worker. */
@Injectable()
export class JobsService {
  constructor(
    @InjectQueue(TRANSCRIBE_QUEUE) private readonly transcribeQueue: Queue<MeetingJob>,
    @InjectQueue(SUMMARIZE_QUEUE) private readonly summarizeQueue: Queue<MeetingJob>,
    @InjectQueue(EMAIL_QUEUE) private readonly emailQueue: Queue<EmailJob>,
    @InjectQueue(BOT_IMPORT_QUEUE) private readonly botImportQueue: Queue<MeetingJob>,
  ) {}

  /** Webhooks may arrive twice; one import per meeting run. */
  async importBot(meetingId: string, run: number): Promise<void> {
    await this.botImportQueue.add('bot-import', { meetingId, run }, { jobId: meetingJobId(meetingId, 'bot-import', run), ...BOT_IMPORT_JOB_OPTIONS });
  }

  async transcribe(meetingId: string, run: number): Promise<void> {
    await this.transcribeQueue.add('transcribe', { meetingId, run }, { jobId: meetingJobId(meetingId, 'transcribe', run) });
  }

  async summarize(meetingId: string, run: number): Promise<void> {
    await this.summarizeQueue.add('summarize', { meetingId, run }, { jobId: meetingJobId(meetingId, 'summarize', run) });
  }

  async email(job: EmailJob): Promise<void> {
    await this.emailQueue.add(job.type, job, { jobId: emailJobId(job) });
  }
}
