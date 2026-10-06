import { and, eq, isNotNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { Database } from './db/db.module';
import * as schema from './db/schema';
import { actionItems, meetings } from './db/schema';
import { resolveDueDate } from './processing/due-date';

/**
 * One-off: gives existing action items the due date their spoken deadline means ("today or
 * tomorrow" said on Oct 6 → Oct 7), counted from their meeting's day. Items are updated in place,
 * so ticks and owners stay. Deadlines the rules can't place keep the date they have.
 *   node dist/backfill-due-dates.js            # writes
 *   node dist/backfill-due-dates.js --dry-run  # only reports
 */
export async function backfillDueDates(db: Database, opts: { dryRun?: boolean } = {}): Promise<{ checked: number; changed: { id: string; due: string; from: string | null; to: string }[] }> {
  const rows = await db
    .select({ meetingId: actionItems.meetingId, id: actionItems.id, due: actionItems.due, dueDate: actionItems.dueDate, startedAt: meetings.startedAt })
    .from(actionItems)
    .innerJoin(meetings, eq(meetings.id, actionItems.meetingId))
    .where(isNotNull(actionItems.due));
  const changed: { id: string; due: string; from: string | null; to: string }[] = [];
  for (const r of rows) {
    const to = resolveDueDate(r.due, r.startedAt);
    if (!to || to === r.dueDate) continue;
    changed.push({ id: r.id, due: r.due!, from: r.dueDate, to });
    if (!opts.dryRun) {
      await db.update(actionItems).set({ dueDate: to }).where(and(eq(actionItems.meetingId, r.meetingId), eq(actionItems.id, r.id)));
    }
  }
  return { checked: rows.length, changed };
}

if (require.main === module) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url, max: 1 });
  const dryRun = process.argv.includes('--dry-run');
  backfillDueDates(drizzle(pool, { schema }) as unknown as Database, { dryRun })
    .then(({ checked, changed }) => {
      for (const c of changed) process.stdout.write(`${c.from ?? '—'} → ${c.to}  “${c.due}”\n`);
      process.stdout.write(`${dryRun ? 'would change' : 'changed'} ${changed.length} of ${checked} action items with a deadline\n`);
    })
    .catch((err: unknown) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
