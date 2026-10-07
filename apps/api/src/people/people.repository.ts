import { Injectable } from '@nestjs/common';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { InjectDb, type Database } from '../db/db.module';
import { actionItems, meetings, segments, type SpeakerNameMap } from '../db/schema';
import { NO_DUE, type TaskRow } from '../tasks/tasks.repository';
import type { SpeakerTimeRow } from './people';

/** Finished meetings count; the demo meeting's made-up people don't. */
const counted = (userId: string, since: Date | null) =>
  and(
    eq(meetings.userId, userId),
    eq(meetings.status, 'ready'),
    ne(meetings.source, 'demo'),
    since ? sql`${meetings.startedAt} >= ${since.toISOString()}::timestamptz` : undefined,
  );

@Injectable()
export class PeopleRepository {
  constructor(@InjectDb() private readonly db: Database) {}

  /** Every speaker of every counted meeting with how long they spoke. */
  async speakerTime(userId: string, since: Date | null): Promise<SpeakerTimeRow[]> {
    const rows = await this.db
      .select({
        meetingId: meetings.id,
        title: meetings.title,
        startedAt: meetings.startedAt,
        durationSec: sql<number | null>`coalesce(${meetings.durationSec}, (select max(e.end_ms) / 1000 from segments e where e.meeting_id = ${meetings.id}))::int`,
        topics: meetings.topics,
        speakerNames: meetings.speakerNames,
        label: segments.speaker,
        talkMs: sql<number>`sum(${segments.endMs} - ${segments.startMs})::int`,
      })
      .from(meetings)
      .innerJoin(segments, eq(segments.meetingId, meetings.id))
      .where(counted(userId, since))
      .groupBy(meetings.id, segments.speaker);
    return rows.map((r) => ({ ...r, speakerNames: r.speakerNames as SpeakerNameMap }));
  }

  /** All counted meetings in the period, added up. */
  async meetingSeconds(userId: string, since: Date | null): Promise<number> {
    const [row] = await this.db
      .select({ sec: sql<number>`coalesce(sum(${meetings.durationSec}), 0)::int` })
      .from(meetings)
      .where(counted(userId, since));
    return row?.sec ?? 0;
  }

  /** Open action items per owner, by lower-case name. */
  async openTasksByOwner(userId: string): Promise<Map<string, number>> {
    const rows = await this.db
      .select({ key: sql<string>`lower(trim(${actionItems.owner}))`, count: sql<number>`count(*)::int` })
      .from(actionItems)
      .where(and(eq(actionItems.userId, userId), eq(actionItems.done, false), sql`${actionItems.owner} is not null`))
      .groupBy(sql`1`);
    return new Map(rows.map((r) => [r.key, r.count]));
  }

  /** A person's action items: open first, soonest due first, newest meeting first. */
  tasksOf(userId: string, key: string): Promise<TaskRow[]> {
    return this.db
      .select({
        id: actionItems.id,
        text: actionItems.text,
        owner: actionItems.owner,
        due: actionItems.due,
        dueDate: actionItems.dueDate,
        done: actionItems.done,
        idx: actionItems.idx,
        meetingId: actionItems.meetingId,
        meetingTitle: meetings.title,
        startedAt: meetings.startedAt,
      })
      .from(actionItems)
      .innerJoin(meetings, eq(meetings.id, actionItems.meetingId))
      .where(and(eq(actionItems.userId, userId), sql`lower(trim(${actionItems.owner})) = ${key}`))
      .orderBy(asc(actionItems.done), sql`coalesce(${actionItems.dueDate}, ${NO_DUE}::date)`, sql`${meetings.startedAt} desc`, asc(actionItems.idx))
      .limit(200);
  }

  /** Gives every action item owned by `key` (in any meeting) to `name`. */
  async renameOwner(userId: string, key: string, name: string): Promise<void> {
    await this.db
      .update(actionItems)
      .set({ owner: name })
      .where(and(eq(actionItems.userId, userId), sql`lower(trim(${actionItems.owner})) = ${key}`));
  }
}
