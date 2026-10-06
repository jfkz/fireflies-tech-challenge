import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import { InjectDb, type Database } from '../db/db.module';
import { actionItems, meetings } from '../db/schema';
import type { TaskCursor } from './task-cursor';

/** Tasks without a due date sort after every dated one. */
export const NO_DUE = '9999-12-31';

export interface TaskRow {
  id: string;
  text: string;
  owner: string | null;
  due: string | null;
  dueDate: string | null;
  done: boolean;
  idx: number;
  meetingId: string;
  meetingTitle: string;
  startedAt: Date;
}

@Injectable()
export class TasksRepository {
  constructor(@InjectDb() private readonly db: Database) {}

  /**
   * A user's action items across meetings: open first, soonest due first, undated last,
   * then newest meeting first, then summary order. Keyset-paginated on that order.
   */
  list(userId: string, opts: { status: 'open' | 'done' | 'all'; owner?: string; cursor: TaskCursor | null; limit: number }): Promise<TaskRow[]> {
    const dueSort = sql`coalesce(${actionItems.dueDate}, ${NO_DUE}::date)`;
    const where: SQL[] = [eq(actionItems.userId, userId)];
    if (opts.status !== 'all') where.push(eq(actionItems.done, opts.status === 'done'));
    if (opts.owner) where.push(eq(actionItems.owner, opts.owner));
    const c = opts.cursor;
    if (c) {
      // (done, due) ascending, then started_at descending, then (meeting, idx) ascending.
      where.push(sql`(
        (${actionItems.done}, ${dueSort}) > (${c.done}, ${c.dueSort}::date)
        or ((${actionItems.done}, ${dueSort}) = (${c.done}, ${c.dueSort}::date) and (
          ${meetings.startedAt} < ${c.startedAt.toISOString()}::timestamptz
          or (${meetings.startedAt} = ${c.startedAt.toISOString()}::timestamptz and (${actionItems.meetingId}, ${actionItems.idx}) > (${c.meetingId}::uuid, ${c.idx}))
        ))
      )`);
    }
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
      .where(and(...where))
      .orderBy(asc(actionItems.done), asc(dueSort), desc(meetings.startedAt), asc(actionItems.meetingId), asc(actionItems.idx))
      .limit(opts.limit);
  }
}
