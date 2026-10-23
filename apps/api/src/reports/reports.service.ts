import { AnalyticsService } from '../analytics/analytics.service';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type {
  ListProblemReportsQuery,
  ProblemReportDetail,
  ProblemReportPage,
  ProblemReportRequest,
  ProblemReportResponse,
  ProblemReportSummary,
} from '@boringtalks/shared';
import { decodeCursor, encodeCursor } from '../common/cursor';
import { validationError } from '../common/zod.pipe';
import { AppConfig } from '../config/config.module';
import type { UserRow } from '../db/schema';
import { JobsService } from '../queues/jobs.service';
import { ReportsRepository, type ReportListItem, type ReportWithUser } from './reports.repository';

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly config: AppConfig,
    private readonly reports: ReportsRepository,
    private readonly jobs: JobsService,
    private readonly analytics?: AnalyticsService,
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
    this.analytics?.capture(user.id, 'problem_report_sent', { kind: row.kind, flavor: row.flavor, appVersion: row.appVersion });
    if (this.config.env.REPORTS_NOTIFY_EMAIL) {
      await this.jobs.email({ type: 'problem-report', userId: user.id, reportId: row.id });
    }
    return { id: row.id, receivedAt: row.createdAt.toISOString() };
  }

  /** Everyone's reports, newest first: for admins. */
  async list(query: ListProblemReportsQuery): Promise<ProblemReportPage> {
    const before = query.cursor ? decodeCursor(query.cursor) : null;
    if (query.cursor && !before) throw validationError([{ path: 'cursor', message: 'Invalid cursor' }]);
    const rows = await this.reports.list({ user: query.user, kind: query.kind, before, limit: query.limit + 1 });
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map(toSummary),
      nextCursor: rows.length > query.limit && last ? encodeCursor({ startedAt: last.createdAt, id: last.id }) : null,
    };
  }

  async get(id: string): Promise<ProblemReportDetail> {
    const found = await this.reports.findById(id);
    if (!found) throw new NotFoundException('Report not found');
    return toDetail(found);
  }
}

export function toSummary(r: ReportListItem): ProblemReportSummary {
  return {
    id: r.id,
    kind: r.kind,
    message: r.message,
    user: { id: r.userId, email: r.email },
    deviceId: r.deviceId,
    app: { version: r.appVersion, build: r.appBuild, flavor: r.flavor },
    system: { os: r.os, model: r.model },
    logBytes: r.logBytes,
    createdAt: r.createdAt.toISOString(),
  };
}

export function toDetail({ report: { log, diagnostics, ...r }, email }: ReportWithUser): ProblemReportDetail {
  return { ...toSummary({ ...r, email, logBytes: Buffer.byteLength(log) }), diagnostics, log };
}
