import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { EMAIL_QUEUE, type EmailJob } from '../queues/queues';
import { EmailService, type SendOutcome } from './email.service';

@Processor(EMAIL_QUEUE, { concurrency: 4 })
export class EmailProcessor extends WorkerHost {
  constructor(private readonly email: EmailService) {
    super();
  }

  process(job: Job<EmailJob>): Promise<SendOutcome> {
    return this.email.send(job.data);
  }
}
