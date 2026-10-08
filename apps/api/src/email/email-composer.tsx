import { Injectable } from '@nestjs/common';
import { render } from '@react-email/render';
import type { ReactElement } from 'react';
import { AppConfig } from '../config/config.module';
import type { UserRow } from '../db/schema';
import { DevicesRepository } from '../devices/devices.repository';
import { MeetingsRepository } from '../meetings/meetings.repository';
import { ReportsRepository } from '../reports/reports.repository';
import type { EmailJob } from '../queues/queues';
import { DeviceConnectedEmail } from './templates/device-connected';
import { MeetingReadyEmail } from './templates/meeting-ready';
import { ProblemReportEmail } from './templates/problem-report';
import { WelcomeEmail } from './templates/welcome';

export interface ComposedEmail {
  subject: string;
  html: string;
  text: string;
}

/** Builds the subject and body of each email type from current data; null when there is nothing to send. */
@Injectable()
export class EmailComposer {
  constructor(
    private readonly config: AppConfig,
    private readonly meetings: MeetingsRepository,
    private readonly devices: DevicesRepository,
    private readonly reports: ReportsRepository,
  ) {}

  async compose(job: EmailJob, user: UserRow): Promise<ComposedEmail | null> {
    const web = this.config.env.WEB_URL.replace(/\/$/, '');
    switch (job.type) {
      case 'welcome':
        return renderEmail('Welcome to BoringTalks', <WelcomeEmail name={user.name} dashboardUrl={`${web}/meetings`} />);
      case 'meeting-ready': {
        const meeting = await this.meetings.findById(job.meetingId);
        const summary = meeting && (await this.meetings.getSummary(meeting.id));
        if (!meeting || !summary) return null;
        return renderEmail(
          `Ready: ${meeting.title}`,
          <MeetingReadyEmail
            title={meeting.title}
            description={meeting.description}
            summary={summary.summary}
            actionItems={summary.actionItems}
            url={`${web}/meetings/${meeting.id}`}
          />,
        );
      }
      case 'device-connected': {
        const device = await this.devices.findById(job.deviceId);
        if (!device) return null;
        const connectedAt = device.createdAt.toUTCString().replace(' GMT', ' UTC');
        return renderEmail(
          `New Mac connected: ${device.name}`,
          <DeviceConnectedEmail deviceName={device.name} connectedAt={connectedAt} settingsUrl={`${web}/settings`} />,
        );
      }
      case 'problem-report': {
        const found = await this.reports.findById(job.reportId);
        if (!found) return null;
        const { report } = found;
        const what = report.kind === 'hang' ? 'Hang' : 'Problem report';
        return renderEmail(
          `${what}: BoringTalks ${report.appVersion}${report.flavor === 'dev' ? ' (Dev)' : ''} from ${user.email ?? user.id}`,
          <ProblemReportEmail
            reportId={report.id}
            kind={report.kind}
            from={user.email ?? user.id}
            app={`BoringTalks${report.flavor === 'dev' ? ' Dev' : ''} ${report.appVersion}${report.appBuild ? ` (${report.appBuild})` : ''}`}
            system={[report.os, report.model].filter(Boolean).join(', ')}
            message={report.message}
            logBytes={Buffer.byteLength(report.log)}
          />,
        );
      }
    }
  }
}

export async function renderEmail(subject: string, element: ReactElement): Promise<ComposedEmail> {
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { subject, html, text };
}
