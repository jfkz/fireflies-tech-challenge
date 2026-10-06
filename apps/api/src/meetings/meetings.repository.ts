import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, getTableColumns, inArray, sql, type SQL } from 'drizzle-orm';
import type { ActionItem, FacetCount, MeetingStatus, Segment } from '@boringtalks/shared';
import type { MeetingCursor } from '../common/cursor';
import { InjectDb, type Database } from '../db/db.module';
import { actionItems, meetings, segments, summaries, type MeetingRow, type SpeakerNameMap, type SummaryRow } from '../db/schema';

export type MeetingWithCount = MeetingRow & { actionItemCount: number };
export type NewMeeting = typeof meetings.$inferInsert;
export type MeetingPatch = Partial<Omit<NewMeeting, 'id' | 'userId' | 'createdAt'>>;
export type SummaryValues = Omit<typeof summaries.$inferInsert, 'meetingId' | 'createdAt' | 'legacyActionItems'> & { actionItems: ActionItem[] };
/** A summary row with its action items, in order. */
export type SummaryWithItems = Omit<SummaryRow, 'legacyActionItems'> & { actionItems: ActionItem[] };

const ITEM_COLUMNS = {
  id: actionItems.id,
  text: actionItems.text,
  owner: actionItems.owner,
  due: actionItems.due,
  dueDate: actionItems.dueDate,
  done: actionItems.done,
};

/** Rows per INSERT; 6 columns × 1000 rows stays far below Postgres' 65k parameter limit. */
const SEGMENT_BATCH = 1_000;

@Injectable()
export class MeetingsRepository {
  constructor(@InjectDb() private readonly db: Database) {}

  async create(values: NewMeeting): Promise<MeetingRow> {
    const [row] = await this.db.insert(meetings).values(values).returning();
    return row;
  }

  /** Creates the meeting unless this user already used `clientKey`; returns null in that case. */
  async createOnce(values: NewMeeting & { clientKey: string }): Promise<MeetingRow | null> {
    const [row] = await this.db
      .insert(meetings)
      .values(values)
      .onConflictDoNothing({ target: [meetings.userId, meetings.clientKey] })
      .returning();
    return row ?? null;
  }

  async findByClientKey(userId: string, clientKey: string): Promise<MeetingRow | null> {
    const [row] = await this.db
      .select()
      .from(meetings)
      .where(and(eq(meetings.userId, userId), eq(meetings.clientKey, clientKey)));
    return row ?? null;
  }

  async findById(id: string): Promise<MeetingRow | null> {
    const [row] = await this.db.select().from(meetings).where(eq(meetings.id, id));
    return row ?? null;
  }

  async findOwned(userId: string, id: string): Promise<MeetingRow | null> {
    const [row] = await this.db
      .select()
      .from(meetings)
      .where(and(eq(meetings.id, id), eq(meetings.userId, userId)));
    return row ?? null;
  }

  /**
   * One page, newest first, with an optional full-text query over titles, descriptions and
   * transcripts, and optional filters by speaker, topic and start time.
   */
  list(
    userId: string,
    opts: { cursor: MeetingCursor | null; limit: number; q?: string; speaker?: string; topic?: string; from?: Date; to?: Date },
  ): Promise<MeetingWithCount[]> {
    const where: SQL[] = [eq(meetings.userId, userId)];
    if (opts.cursor) {
      where.push(
        sql`(${meetings.startedAt}, ${meetings.id}) < (${opts.cursor.startedAt.toISOString()}::timestamptz, ${opts.cursor.id}::uuid)`,
      );
    }
    if (opts.q) {
      const query = sql`websearch_to_tsquery('simple', ${opts.q})`;
      where.push(
        sql`(${meetings.search} @@ ${query} or exists (select 1 from ${segments} where ${segments.meetingId} = ${meetings.id} and to_tsvector('simple', ${segments.text}) @@ ${query}))`,
      );
    }
    if (opts.speaker) where.push(sql`${meetings.speakers} @> array[${opts.speaker}]::text[]`);
    if (opts.topic) where.push(sql`${meetings.topics} @> array[${opts.topic}]::text[]`);
    if (opts.from) where.push(sql`${meetings.startedAt} >= ${opts.from.toISOString()}::timestamptz`);
    if (opts.to) where.push(sql`${meetings.startedAt} < ${opts.to.toISOString()}::timestamptz`);
    return this.db
      .select({
        ...getTableColumns(meetings),
        // Spelled out: inside a subquery Drizzle leaves column names unqualified, and "id" exists in both tables.
        actionItemCount: sql<number>`(select count(*) from action_items ai where ai.meeting_id = "meetings"."id")::int`,
      })
      .from(meetings)
      .where(and(...where))
      .orderBy(desc(meetings.startedAt), desc(meetings.id))
      .limit(opts.limit);
  }

  /** The user's speakers and topics with the number of meetings each appears in, most frequent first. */
  async facets(userId: string, limit: number): Promise<{ speakers: FacetCount[]; topics: FacetCount[] }> {
    const count = (column: typeof meetings.speakers | typeof meetings.topics) =>
      this.db.execute<{ value: string; count: number }>(sql`
        select v as value, count(*)::int as count
        from ${meetings}, unnest(${column}) as v
        where ${meetings.userId} = ${userId}
        group by v
        order by count(*) desc, v asc
        limit ${limit}`);
    const [speakers, topics] = await Promise.all([count(meetings.speakers), count(meetings.topics)]);
    return { speakers: speakers.rows, topics: topics.rows };
  }

  /**
   * Meetings and minutes per calendar day in `tz`, for days in [from, to) that had any.
   * Days are the meeting's start in that time zone.
   */
  async dailyStats(userId: string, from: string, to: string, tz: string): Promise<{ date: string; count: number; totalSec: number }[]> {
    const day = sql`(${meetings.startedAt} at time zone ${tz})::date`;
    const rows = await this.db
      .select({ date: sql<string>`to_char(${day}, 'YYYY-MM-DD')`, count: sql<number>`count(*)::int`, totalSec: sql<number>`coalesce(sum(${meetings.durationSec}), 0)::int` })
      .from(meetings)
      .where(
        and(
          eq(meetings.userId, userId),
          sql`${meetings.startedAt} >= (${from}::timestamp at time zone ${tz})`,
          sql`${meetings.startedAt} < (${to}::timestamp at time zone ${tz})`,
        ),
      )
      // By position: the time zone is a separate bind parameter in each clause, so Postgres
      // wouldn't see the expressions as the same.
      .groupBy(sql`1`)
      .orderBy(sql`1`);
    return rows;
  }

  /** The user's most used topic tags, so new summaries reuse them. */
  async topTopics(userId: string, limit: number): Promise<string[]> {
    return (await this.facets(userId, limit)).topics.map((t) => t.value);
  }

  /** A meeting's raw speaker labels in order of first appearance. */
  async speakerLabels(meetingId: string): Promise<string[]> {
    const rows = await this.db
      .select({ speaker: segments.speaker })
      .from(segments)
      .where(eq(segments.meetingId, meetingId))
      .groupBy(segments.speaker)
      .orderBy(sql`min(${segments.idx})`);
    return rows.map((r) => r.speaker);
  }

  /**
   * Stores new speaker names, the cached display list, and moves action item
   * owners from old to new names, in one transaction.
   */
  async saveSpeakerNames(meetingId: string, map: SpeakerNameMap, speakers: string[], owners: readonly [string, string][]): Promise<MeetingRow> {
    return this.db.transaction(async (tx) => {
      // All renames at once (a swap A↔B must not chain), so map old owner → new owner in one UPDATE.
      if (owners.length > 0) {
        const cases = sql.join(
          owners.map(([from, to]) => sql`when ${from} then ${to}`),
          sql` `,
        );
        await tx
          .update(actionItems)
          .set({ owner: sql`case ${actionItems.owner} ${cases} else ${actionItems.owner} end` })
          .where(and(eq(actionItems.meetingId, meetingId), inArray(actionItems.owner, owners.map(([from]) => from))));
      }
      const [meeting] = await tx.update(meetings).set({ speakerNames: map, speakers }).where(eq(meetings.id, meetingId)).returning();
      return meeting;
    });
  }

  /**
   * Gives speaker "You" a new name in all of a user's meetings, except where the
   * user named that speaker by hand. Action item owners follow. Returns how many
   * meetings changed.
   */
  async renameOwner(userId: string, name: string): Promise<number> {
    const result = await this.db.execute(sql`
      with targets as (
        select id, coalesce(speaker_names->'You'->>'name', 'You') as old
        from ${meetings}
        where user_id = ${userId}
          and coalesce(speaker_names->'You'->>'by', 'ai') <> 'user'
          and coalesce(speaker_names->'You'->>'name', 'You') = any(speakers)
          and coalesce(speaker_names->'You'->>'name', 'You') <> ${name}
      ),
      owners as (
        update ${actionItems} a
        set owner = ${name}::text
        from targets t
        where a.meeting_id = t.id and a.owner = t.old
        returning 1
      )
      update ${meetings} m
      set speaker_names = m.speaker_names || jsonb_build_object('You', jsonb_build_object('name', ${name}::text, 'by', 'ai')),
          speakers = array_replace(m.speakers, t.old, ${name}::text),
          updated_at = now()
      from targets t
      where m.id = t.id`);
    return result.rowCount ?? 0;
  }

  async update(id: string, patch: MeetingPatch): Promise<MeetingRow | null> {
    const [row] = await this.db.update(meetings).set(patch).where(eq(meetings.id, id)).returning();
    return row ?? null;
  }

  /** Compare-and-set on status, so two racing requests cannot both start processing. */
  async transition(id: string, from: MeetingStatus, patch: MeetingPatch & { status: MeetingStatus }): Promise<MeetingRow | null> {
    const [row] = await this.db
      .update(meetings)
      .set(patch)
      .where(and(eq(meetings.id, id), eq(meetings.status, from)))
      .returning();
    return row ?? null;
  }

  /** Starts a processing run: sets the status, bumps `attempts`, clears the last error. */
  async startRun(id: string, from: MeetingStatus, to: MeetingStatus, patch: MeetingPatch = {}): Promise<MeetingRow | null> {
    const [row] = await this.db
      .update(meetings)
      .set({ ...patch, status: to, error: null, attempts: sql`${meetings.attempts} + 1` })
      .where(and(eq(meetings.id, id), eq(meetings.status, from)))
      .returning();
    return row ?? null;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(meetings).where(eq(meetings.id, id));
  }

  async getSegments(meetingId: string): Promise<Segment[]> {
    return this.db
      .select({ speaker: segments.speaker, startMs: segments.startMs, endMs: segments.endMs, text: segments.text })
      .from(segments)
      .where(eq(segments.meetingId, meetingId))
      .orderBy(asc(segments.idx));
  }

  async hasSegments(meetingId: string): Promise<boolean> {
    const rows = await this.db.select({ one: sql`1` }).from(segments).where(eq(segments.meetingId, meetingId)).limit(1);
    return rows.length > 0;
  }

  /** Replaces the whole transcript of a meeting and updates the cached fields in one transaction. */
  async replaceTranscript(meetingId: string, list: readonly Segment[], patch: MeetingPatch): Promise<MeetingRow> {
    return this.db.transaction(async (tx) => {
      await tx.delete(segments).where(eq(segments.meetingId, meetingId));
      for (let i = 0; i < list.length; i += SEGMENT_BATCH) {
        await tx.insert(segments).values(list.slice(i, i + SEGMENT_BATCH).map((s, j) => ({ meetingId, idx: i + j, ...s })));
      }
      // Touch updated_at even with an empty patch, so list caches see the change.
      const [row] = await tx.update(meetings).set({ ...patch, updatedAt: new Date() }).where(eq(meetings.id, meetingId)).returning();
      return row;
    });
  }

  async getSummary(meetingId: string): Promise<SummaryWithItems | null> {
    const [row] = await this.db.select().from(summaries).where(eq(summaries.meetingId, meetingId));
    if (!row) return null;
    const { legacyActionItems: _legacy, ...summary } = row;
    return { ...summary, actionItems: await this.getActionItems(meetingId) };
  }

  async getActionItems(meetingId: string): Promise<ActionItem[]> {
    return this.db.select(ITEM_COLUMNS).from(actionItems).where(eq(actionItems.meetingId, meetingId)).orderBy(asc(actionItems.idx));
  }

  /** Stores a summary and replaces the meeting's action items, in one transaction. */
  async saveSummary(meetingId: string, { actionItems: items, ...values }: SummaryValues, patch: MeetingPatch): Promise<MeetingRow> {
    return this.db.transaction(async (tx) => {
      const row = { meetingId, ...values, createdAt: new Date() };
      await tx.insert(summaries).values(row).onConflictDoUpdate({ target: summaries.meetingId, set: row });
      const [meeting] = await tx
        .update(meetings)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(meetings.id, meetingId))
        .returning();
      await tx.delete(actionItems).where(eq(actionItems.meetingId, meetingId));
      if (items.length > 0) {
        await tx.insert(actionItems).values(
          items.map((a, idx) => ({ meetingId, userId: meeting.userId, idx, id: a.id, text: a.text, owner: a.owner, due: a.due, dueDate: a.dueDate, done: a.done })),
        );
      }
      return meeting;
    });
  }

  /** Flips one action item; returns false when the meeting has no such item. */
  async setActionItemDone(meetingId: string, itemId: string, done: boolean): Promise<boolean> {
    const rows = await this.db
      .update(actionItems)
      .set({ done })
      .where(and(eq(actionItems.meetingId, meetingId), eq(actionItems.id, itemId)))
      .returning({ id: actionItems.id });
    return rows.length > 0;
  }
}
