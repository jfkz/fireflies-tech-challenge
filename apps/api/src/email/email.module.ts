import { Module } from '@nestjs/common';
import { Resend } from 'resend';
import { AppConfig } from '../config/config.module';
import { DevicesModule } from '../devices/devices.module';
import { MeetingsModule } from '../meetings/meetings.module';
import { UsersModule } from '../users/users.module';
import { EmailComposer } from './email-composer';
import { EmailLogRepository } from './email-log.repository';
import { EmailProcessor } from './email.processor';
import { EmailService } from './email.service';
import { FakeMailSender, LogMailSender, MailSender, ResendMailSender } from './mail-sender';

/** Worker-side email delivery: the `email` queue processor and everything it needs. */
@Module({
  imports: [UsersModule, MeetingsModule, DevicesModule],
  providers: [
    EmailComposer,
    EmailLogRepository,
    EmailService,
    EmailProcessor,
    {
      provide: MailSender,
      inject: [AppConfig],
      useFactory: (config: AppConfig): MailSender => {
        if (config.env.AI_FAKE) return new FakeMailSender();
        if (config.env.RESEND_API_KEY) return new ResendMailSender(new Resend(config.env.RESEND_API_KEY));
        return new LogMailSender();
      },
    },
  ],
  exports: [MailSender, EmailService],
})
export class EmailModule {}
