import { Injectable, Logger } from '@nestjs/common';
import type { ProblemReportRequest, ProblemReportResponse } from '@boringtalks/shared';
import { AppConfig } from '../config/config.module';
import type { UserRow } from '../db/schema';
import { JobsService } from '../queues/jobs.service';
import { ReportsRepository } from './reports.repository';

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly config: AppConfig,
    private readonly reports: ReportsRepository,
    private readonly jobs: JobsService,
  ) {}

  /** Keeps the report, and tells the operator when REPORTS_NOTIFY_EMAIL is set. */
  async create(user: UserRow, deviceId: string | null, body: ProblemReportRequest): Promise<ProblemReportResponse> {
    const row = await this.reports.insert({
      userId: user.id,
      deviceId,
      kind: body.kind,
      message: body.message,
      appVersion: body.app.version,
      appBuild: body.app.build,
      flavor: body.app.flavor,
      os: body.system.os,
      model: body.system.model,
      diagnostics: body.diagnostics,
      log: body.log,
    });
    this.logger.log(
      { reportId: row.id, userId: user.id, deviceId, kind: row.kind, appVersion: row.appVersion, flavor: row.flavor, logBytes: Buffer.byteLength(row.log) },
      'problem report received',
    );
    if (this.config.env.REPORTS_NOTIFY_EMAIL) {
      await this.jobs.email({ type: 'problem-report', userId: user.id, reportId: row.id });
    }
    return { id: row.id, receivedAt: row.createdAt.toISOString() };
  }
}
