import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../config/config.module';
import { UsersRepository } from '../users/users.repository';
import { emailJobId, type EmailJob } from '../queues/queues';
import { EmailComposer } from './email-composer';
import { EmailLogRepository } from './email-log.repository';
import { MailSender } from './mail-sender';

export type SendOutcome = 'sent' | 'duplicate' | 'not-allowed' | 'skipped';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    private readonly config: AppConfig,
    private readonly users: UsersRepository,
    private readonly composer: EmailComposer,
    private readonly log: EmailLogRepository,
    private readonly sender: MailSender,
  ) {}

  /**
   * Sends one email at most once per idempotency key: the key is claimed in
   * email_log first and also passed to Resend, which dedupes a crash between
   * its send and our bookkeeping.
   */
  async send(job: EmailJob): Promise<SendOutcome> {
    const key = emailJobId(job);
    const user = await this.users.findById(job.userId);
    // A problem report goes to the operator; everything else to the user.
    const to = job.type === 'problem-report' ? this.config.env.REPORTS_NOTIFY_EMAIL : user?.email;
    if (!user || !to) return this.skip(job, 'no user or no email address');
    if (job.type === 'meeting-ready' && !user.emailOnReady) return this.skip(job, 'user turned ready emails off');
    if (!this.allowed(to)) {
      this.logger.log({ type: job.type, key }, 'recipient not in EMAIL_ALLOWLIST; not sending');
      return 'not-allowed';
    }
    const email = await this.composer.compose(job, user);
    if (!email) return this.skip(job, 'its subject no longer exists');
    if (!(await this.log.claim(key, user.id, job.type))) return 'duplicate';
    try {
      await this.sender.send({ from: this.config.env.EMAIL_FROM, to, ...email, idempotencyKey: key });
    } catch (err) {
      await this.log.release(key);
      throw err;
    }
    this.logger.log({ type: job.type, key }, 'email handed to the sender');
    return 'sent';
  }

  private allowed(address: string): boolean {
    const list = this.config.env.EMAIL_ALLOWLIST.map((a) => a.toLowerCase());
    return list.length === 0 || list.includes(address.toLowerCase());
  }

  private skip(job: EmailJob, why: string): SendOutcome {
    this.logger.log({ type: job.type, userId: job.userId }, `email skipped: ${why}`);
    return 'skipped';
  }
}
