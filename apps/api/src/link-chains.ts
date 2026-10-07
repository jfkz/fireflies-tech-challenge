import { and, asc, eq, ne } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { Database } from './db/db.module';
import * as schema from './db/schema';
import { meetings, summaries } from './db/schema';
import { MeetingsRepository } from './meetings/meetings.repository';
import { ChainLinker, GatewayChainLinker, linkIntoChain, type ChainLink } from './processing/chain-linker';

/**
 * One-off: links meetings summarized before chains existed, oldest first, the way the pipeline
 * links each new one. Needs AI_GATEWAY_API_KEY (and SUMMARY_MODEL, default Claude Haiku 4.5).
 *   node dist/link-chains.js                 # every user
 *   node dist/link-chains.js --user <uuid>   # one user
 */
export async function linkExistingMeetings(db: Database, linker: ChainLinker, opts: { userId?: string } = {}): Promise<{ checked: number; linked: (ChainLink & { id: string; title: string })[] }> {
  const repo = new MeetingsRepository(db);
  const rows = await db
    .select({ id: meetings.id, summary: summaries.summary })
    .from(meetings)
    .innerJoin(summaries, eq(summaries.meetingId, meetings.id))
    .where(and(eq(meetings.status, 'ready'), ne(meetings.source, 'demo'), opts.userId ? eq(meetings.userId, opts.userId) : undefined))
    .orderBy(asc(meetings.startedAt));
  const linked: (ChainLink & { id: string; title: string })[] = [];
  for (const row of rows) {
    // Read it again: linking an earlier meeting may have put this one in a chain already.
    const meeting = await repo.findById(row.id);
    if (!meeting) continue;
    const link = await linkIntoChain(repo, linker, meeting, row.summary);
    if (link) linked.push({ ...link, id: meeting.id, title: meeting.title });
  }
  return { checked: rows.length, linked };
}

if (require.main === module) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url, max: 1 });
  const at = process.argv.indexOf('--user');
  const userId = at > 0 ? process.argv[at + 1] : undefined;
  const linker = new GatewayChainLinker(process.env.SUMMARY_MODEL || 'anthropic/claude-haiku-4.5');
  linkExistingMeetings(drizzle(pool, { schema }) as unknown as Database, linker, { userId })
    .then(({ checked, linked }) => {
      for (const l of linked) process.stdout.write(`“${l.title}” → ${l.meetingId}: ${l.reason}\n`);
      process.stdout.write(`linked ${linked.length} of ${checked} meetings\n`);
    })
    .catch((err: unknown) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
