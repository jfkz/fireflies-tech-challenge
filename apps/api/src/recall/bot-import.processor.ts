import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { isFinalFailure } from '../processing/processors';
import { BOT_IMPORT_QUEUE, type MeetingJob } from '../queues/queues';
import { BotImportService } from './bot-import.service';

@Processor(BOT_IMPORT_QUEUE)
export class BotImportProcessor extends WorkerHost {
  private readonly logger = new Logger(BotImportProcessor.name);

  constructor(private readonly imports: BotImportService) {
    super();
  }

  process(job: Job<MeetingJob>): Promise<string> {
    return this.imports.import(job.data);
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<MeetingJob> | undefined, err: Error): Promise<void> {
    this.logger.log({ jobId: job?.id, attempt: job?.attemptsMade, err: err.message }, 'bot import not done');
    if (job && isFinalFailure(job, err)) await this.imports.fail(job.data, err);
  }
}
