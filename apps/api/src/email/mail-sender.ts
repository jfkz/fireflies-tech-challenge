import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

export interface OutgoingEmail {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
}

/** Delivery backend; chosen at boot from the environment. */
export abstract class MailSender {
  abstract send(email: OutgoingEmail): Promise<void>;
}

export class ResendMailSender extends MailSender {
  constructor(private readonly resend: Resend) {
    super();
  }

  async send({ idempotencyKey, ...email }: OutgoingEmail): Promise<void> {
    const { error } = await this.resend.emails.send(email, { idempotencyKey });
    if (error) throw new Error(`Resend: ${error.name}: ${error.message}`);
  }
}

/** Used when RESEND_API_KEY is not set: the email is logged instead of sent. */
@Injectable()
export class LogMailSender extends MailSender {
  private readonly logger = new Logger('Email');

  send(email: OutgoingEmail): Promise<void> {
    this.logger.log({ to: email.to, subject: email.subject, key: email.idempotencyKey }, 'email not sent (no RESEND_API_KEY)');
    return Promise.resolve();
  }
}

/** Keeps sent emails in memory; tests read `sent`. */
@Injectable()
export class FakeMailSender extends MailSender {
  readonly sent: OutgoingEmail[] = [];

  send(email: OutgoingEmail): Promise<void> {
    this.sent.push(email);
    return Promise.resolve();
  }
}
