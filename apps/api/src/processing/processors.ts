import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnApplicationBootstrap } from '@nestjs/common';
import { UnrecoverableError, type Job } from 'bullmq';
import { AppConfig } from '../config/config.module';
import { SUMMARIZE_QUEUE, TRANSCRIBE_QUEUE, type MeetingJob } from '../queues/queues';
import { PipelineService } from './pipeline.service';

/** True once BullMQ will not retry this job again. */
const logger = new Logger('Pipeline');

function logFailure(job: Job<MeetingJob> | undefined, err: Error): void {
  logger.warn({ jobId: job?.id, queue: job?.queueName, attempt: job?.attemptsMade, err: err.message }, 'job failed');
}

export function isFinalFailure(job: Job, err: Error): boolean {
  return err instanceof UnrecoverableError || job.attemptsMade >= (job.opts.attempts ?? 1);
}

@Processor(TRANSCRIBE_QUEUE)
export class TranscribeProcessor extends WorkerHost implements OnApplicationBootstrap {
  constructor(
    private readonly pipeline: PipelineService,
    private readonly config: AppConfig,
  ) {
    super();
  }

  onApplicationBootstrap(): void {
    this.worker.concurrency = this.config.env.TRANSCRIBE_CONCURRENCY;
  }

  process(job: Job<MeetingJob>): Promise<string> {
    return this.pipeline.transcribe(job.data);
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<MeetingJob> | undefined, err: Error): Promise<void> {
    logFailure(job, err);
    if (job && isFinalFailure(job, err)) await this.pipeline.fail(job.data, 'transcribing', err);
  }
}

@Processor(SUMMARIZE_QUEUE)
export class SummarizeProcessor extends WorkerHost implements OnApplicationBootstrap {
  constructor(
    private readonly pipeline: PipelineService,
    private readonly config: AppConfig,
  ) {
    super();
  }

  /** Caps parallel LLM calls per worker replica (SUMMARIZE_CONCURRENCY). */
  onApplicationBootstrap(): void {
    this.worker.concurrency = this.config.env.SUMMARIZE_CONCURRENCY;
  }

  process(job: Job<MeetingJob>): Promise<string> {
    return this.pipeline.summarize(job.data);
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<MeetingJob> | undefined, err: Error): Promise<void> {
    logFailure(job, err);
    if (job && isFinalFailure(job, err)) await this.pipeline.fail(job.data, 'summarizing', err);
  }
}
