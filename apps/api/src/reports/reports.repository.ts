import { Injectable } from '@nestjs/common';
import { and, desc, eq, getTableColumns, sql, type SQL } from 'drizzle-orm';
import { InjectDb, type Database } from '../db/db.module';
import type { ProblemReportKind } from '@boringtalks/shared';
import type { MeetingCursor } from '../common/cursor';
import { problemReports, users, type ProblemReportRow } from '../db/schema';

export type NewProblemReport = typeof problemReports.$inferInsert;

/** A report with whose it is. */
export interface ReportWithUser {
  report: ProblemReportRow;
  email: string | null;
}

/** A row of the list: everything but the log. */
export type ReportListItem = Omit<ProblemReportRow, 'log' | 'diagnostics'> & { email: string | null; logBytes: number };

@Injectable()
export class ReportsRepository {
  constructor(@InjectDb() private readonly db: Database) {}

  async insert(values: NewProblemReport): Promise<ProblemReportRow> {
    const [row] = await this.db.insert(problemReports).values(values).returning();
    return row;
  }

  async findById(id: string): Promise<ReportWithUser | null> {
    const [row] = await this.db
      .select({ report: problemReports, email: users.email })
      .from(problemReports)
      .innerJoin(users, eq(users.id, problemReports.userId))
      .where(eq(problemReports.id, id));
    return row ?? null;
  }

  /**
   * Newest first; `user` is a user id or an email address (any case), `before` continues after a
   * report (the cursor's `startedAt` is its time, to the millisecond like the cursor).
   */
  async list(opts: { user?: string; kind?: ProblemReportKind; before?: MeetingCursor | null; limit?: number } = {}): Promise<ReportListItem[]> {
    const filters: SQL[] = [];
    if (opts.user) {
      filters.push(UUID.test(opts.user) ? eq(problemReports.userId, opts.user) : sql`lower(${users.email}) = ${opts.user.toLowerCase()}`);
    }
    if (opts.kind) filters.push(eq(problemReports.kind, opts.kind));
    const sent = sql`date_trunc('milliseconds', ${problemReports.createdAt})`;
    if (opts.before) filters.push(sql`(${sent}, ${problemReports.id}) < (${opts.before.startedAt.toISOString()}::timestamptz, ${opts.before.id}::uuid)`);
    const { log: _log, diagnostics: _diagnostics, ...columns } = getTableColumns(problemReports);
    return this.db
      .select({ ...columns, email: users.email, logBytes: sql<number>`octet_length(${problemReports.log})::int` })
      .from(problemReports)
      .innerJoin(users, eq(users.id, problemReports.userId))
      .where(and(...filters))
      .orderBy(desc(sent), desc(problemReports.id))
      .limit(opts.limit ?? 20);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
