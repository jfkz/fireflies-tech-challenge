import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { Database } from './db/db.module';
import * as schema from './db/schema';
import { ReportsRepository, type ReportListItem, type ReportWithUser } from './reports/reports.repository';

/**
 * Reads problem reports sent from the Mac app.
 *   node dist/reports.js                          # the latest 20
 *   node dist/reports.js --user <uuid|email>      # one user's
 *   node dist/reports.js <report id>              # one report in full, with its log
 */
export interface ReportsArgs {
  id?: string;
  user?: string;
  limit: number;
}

export function parseReportsArgs(argv: string[]): ReportsArgs {
  const args: ReportsArgs = { limit: 20 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--user') args.user = argv[++i];
    else if (arg === '--limit') args.limit = Math.max(1, Number(argv[++i]) || 20);
    else if (!arg.startsWith('--')) args.id = arg;
  }
  return args;
}

const app = (r: { appVersion: string; flavor: string }) => `${r.appVersion}${r.flavor === 'dev' ? ' dev' : ''}`;

/** One line per report: id, time, who, kind, version, the first line of what they wrote. */
export function formatReportLine(r: ReportListItem): string {
  const firstLine = r.message.split('\n')[0].trim();
  const message = firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine;
  return [r.id, r.createdAt.toISOString().slice(0, 16).replace('T', ' '), r.email ?? r.userId, r.kind, app(r), message || '(no message)'].join('  ');
}

export function formatReport({ report: r, email }: ReportWithUser): string {
  const lines = [
    `Report   ${r.id}`,
    `Sent     ${r.createdAt.toISOString()}`,
    `From     ${email ?? '(no email)'} (user ${r.userId}${r.deviceId ? `, device ${r.deviceId}` : ''})`,
    `Kind     ${r.kind}`,
    `App      BoringTalks ${app(r)}${r.appBuild ? ` (${r.appBuild})` : ''}`,
    `Mac      ${[r.os, r.model].filter(Boolean).join(', ')}`,
    '',
    r.message || '(no message)',
    '',
    '── Diagnostics',
    ...Object.entries(r.diagnostics).map(([k, v]) => `${k}: ${v}`),
    '',
    '── Log',
    r.log || '(empty)',
  ];
  return `${lines.join('\n')}\n`;
}

export async function runReports(repo: Pick<ReportsRepository, 'findById' | 'list'>, args: ReportsArgs): Promise<string> {
  if (args.id) {
    if (!/^[0-9a-f-]{36}$/i.test(args.id)) throw new Error(`Not a report id: ${args.id}`);
    const found = await repo.findById(args.id);
    if (!found) throw new Error(`No report ${args.id}`);
    return formatReport(found);
  }
  const rows = await repo.list({ user: args.user, limit: args.limit });
  return rows.length ? `${rows.map(formatReportLine).join('\n')}\n` : 'No reports\n';
}

if (require.main === module) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url, max: 1 });
  const repo = new ReportsRepository(drizzle(pool, { schema }) as unknown as Database);
  runReports(repo, parseReportsArgs(process.argv.slice(2)))
    .then((out) => process.stdout.write(out))
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
