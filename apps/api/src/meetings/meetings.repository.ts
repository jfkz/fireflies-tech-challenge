import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, getTableColumns, sql, type SQL } from 'drizzle-orm';
import type { ActionItem, MeetingStatus, Segment } from '@boringtalks/shared';
import type { MeetingCursor } from '../common/cursor';
import { InjectDb, type Database } from '../db/db.module';
import { meetings, segments, summaries, type MeetingRow, type SummaryRow } from '../db/schema';

export type MeetingWithCount = MeetingRow & { actionItemCount: number };
export type NewMeeting = typeof meetings.$inferInsert;
export type MeetingPatch = Partial<Omit<NewMeeting, 'id' | 'userId' | 'createdAt'>>;
export type SummaryValues = Omit<typeof summaries.$inferInsert, 'meetingId' | 'createdAt'>;

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

  /** One page, newest first, with an optional full-text query over titles, descriptions and transcripts. */
  list(userId: string, opts: { cursor: MeetingCursor | null; limit: number; q?: string }): Promise<MeetingWithCount[]> {
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
    return this.db
      .select({
        ...getTableColumns(meetings),
        actionItemCount: sql<number>`coalesce(jsonb_array_length(${summaries.actionItems}), 0)::int`,
      })
      .from(meetings)
      .leftJoin(summaries, eq(summaries.meetingId, meetings.id))
      .where(and(...where))
      .orderBy(desc(meetings.startedAt), desc(meetings.id))
      .limit(opts.limit);
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

  async getSummary(meetingId: string): Promise<SummaryRow | null> {
    const [row] = await this.db.select().from(summaries).where(eq(summaries.meetingId, meetingId));
    return row ?? null;
  }

  async saveSummary(meetingId: string, values: SummaryValues, patch: MeetingPatch): Promise<MeetingRow> {
    return this.db.transaction(async (tx) => {
      const row = { meetingId, ...values, createdAt: new Date() };
      await tx.insert(summaries).values(row).onConflictDoUpdate({ target: summaries.meetingId, set: row });
      const [meeting] = await tx
        .update(meetings)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(meetings.id, meetingId))
        .returning();
      return meeting;
    });
  }

  /** Flips one action item; returns false when the meeting has no such item. */
  async setActionItemDone(meetingId: string, itemId: string, done: boolean): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ actionItems: summaries.actionItems })
        .from(summaries)
        .where(eq(summaries.meetingId, meetingId))
        .for('update');
      if (!row?.actionItems.some((a) => a.id === itemId)) return false;
      const next: ActionItem[] = row.actionItems.map((a) => (a.id === itemId ? { ...a, done } : a));
      await tx.update(summaries).set({ actionItems: next }).where(eq(summaries.meetingId, meetingId));
      return true;
    });
  }
}
