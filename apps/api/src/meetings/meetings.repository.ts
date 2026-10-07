import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, getTableColumns, inArray, ne, sql, type SQL } from 'drizzle-orm';
import type { ActionItem, FacetCount, MeetingRef, MeetingStatus, SearchMatch, Segment } from '@boringtalks/shared';
import type { MeetingCursor } from '../common/cursor';
import { HIT_END, HIT_START, toTsQuery } from './search-query';
import { InjectDb, type Database } from '../db/db.module';
import { actionItems, meetings, segments, summaries, type MeetingRow, type SpeakerNameMap, type SummaryRow } from '../db/schema';

export type MeetingWithCount = MeetingRow & { actionItemCount: number };
export type NewMeeting = typeof meetings.$inferInsert;
export type MeetingPatch = Partial<Omit<NewMeeting, 'id' | 'userId' | 'createdAt'>>;
export type SummaryValues = Omit<typeof summaries.$inferInsert, 'meetingId' | 'createdAt' | 'legacyActionItems' | 'search'> & { actionItems: ActionItem[] };
/** A summary row with its action items, in order. */
export type SummaryWithItems = Omit<SummaryRow, 'legacyActionItems' | 'search'> & { actionItems: ActionItem[] };

/** Everything in a summary worth searching, as one text. */
export function summaryDocument(v: Pick<SummaryValues, 'summary' | 'keyTopics' | 'decisions' | 'actionItems'>): string {
  return [v.summary, ...v.keyTopics, ...v.decisions, ...v.actionItems.flatMap((a) => [a.text, a.owner ?? ''])].filter(Boolean).join('\n');
}

export type MeetingHit = MeetingWithCount & { match: SearchMatch | null };

/** A meeting the chain linker may connect another one to. */
export type ChainCandidateRow = Pick<MeetingRow, 'id' | 'title' | 'description' | 'startedAt' | 'speakers' | 'topics' | 'chainId'>;

/** How far apart (days) two meetings of one chain may be, for the summarizer to link them. */
export const CHAIN_WINDOW_DAYS = 45;

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

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
  async list(
    userId: string,
    opts: { cursor: MeetingCursor | null; limit: number; q?: string; speaker?: string; topic?: string; from?: Date; to?: Date },
  ): Promise<MeetingHit[]> {
    const where: SQL[] = [eq(meetings.userId, userId)];
    if (opts.cursor) {
      where.push(
        sql`(${meetings.startedAt}, ${meetings.id}) < (${opts.cursor.startedAt.toISOString()}::timestamptz, ${opts.cursor.id}::uuid)`,
      );
    }
    const tsq = opts.q ? toTsQuery(opts.q) : null;
    // A search with nothing searchable in it ("!!!") finds nothing rather than everything.
    if (opts.q && !tsq) return [];
    const query = sql`to_tsquery('simple', ${tsq})`;
    if (tsq) {
      where.push(sql`(
        ${meetings.search} @@ ${query}
        or to_tsvector('simple', array_to_string(${meetings.speakers} || ${meetings.topics}, ' ')) @@ ${query}
        or exists (select 1 from ${summaries} where ${summaries.meetingId} = ${meetings.id} and ${summaries.search} @@ ${query})
        or exists (select 1 from ${segments} where ${segments.meetingId} = ${meetings.id} and to_tsvector('simple', ${segments.text}) @@ ${query})
      )`);
    }
    if (opts.speaker) where.push(sql`${meetings.speakers} @> array[${opts.speaker}]::text[]`);
    if (opts.topic) where.push(sql`${meetings.topics} @> array[${opts.topic}]::text[]`);
    if (opts.from) where.push(sql`${meetings.startedAt} >= ${opts.from.toISOString()}::timestamptz`);
    if (opts.to) where.push(sql`${meetings.startedAt} < ${opts.to.toISOString()}::timestamptz`);
    const rows = await this.db
      .select({
        ...getTableColumns(meetings),
        // Spelled out: inside a subquery Drizzle leaves column names unqualified, and "id" exists in both tables.
        actionItemCount: sql<number>`(select count(*) from action_items ai where ai.meeting_id = "meetings"."id")::int`,
      })
      .from(meetings)
      .where(and(...where))
      .orderBy(desc(meetings.startedAt), desc(meetings.id))
      .limit(opts.limit);
    if (!tsq) return rows.map((r) => ({ ...r, match: null }));
    const matches = await this.searchMatches(
      rows.map((r) => r.id),
      tsq,
    );
    return rows.map((r) => ({ ...r, match: matches.get(r.id) ?? null }));
  }

  /**
   * Why each meeting matched, for the result list: its first matching transcript line (with the
   * speaker's display name and time, and how many lines match), else its notes, title or people.
   */
  private async searchMatches(ids: string[], tsq: string): Promise<Map<string, SearchMatch>> {
    if (ids.length === 0) return new Map();
    const opts = `StartSel=${HIT_START}, StopSel=${HIT_END}, MaxWords=22, MinWords=10, ShortWord=2, HighlightAll=false`;
    const result = await this.db.execute<{
      id: string;
      seg_speaker: string | null;
      seg_start: number | null;
      seg_snippet: string | null;
      hits: number;
      notes_snippet: string | null;
      title_hit: boolean;
      title: string;
      description: string | null;
      people: string;
    }>(sql`
      with q as (select to_tsquery('simple', ${tsq}) as q)
      select m.id, m.title, m.description,
        coalesce(m.speaker_names -> hit.speaker ->> 'name', hit.speaker) as seg_speaker,
        hit.start_ms as seg_start,
        ts_headline('simple', hit.text, q.q, ${opts}) as seg_snippet,
        (select count(*) from segments s where s.meeting_id = m.id and to_tsvector('simple', s.text) @@ q.q)::int as hits,
        case when sm.search @@ q.q then ts_headline('simple', sm.summary, q.q, ${opts}) end as notes_snippet,
        m.search @@ q.q as title_hit,
        array_to_string(m.speakers || m.topics, ', ') as people
      from meetings m
      cross join q
      left join summaries sm on sm.meeting_id = m.id
      left join lateral (
        select s.speaker, s.start_ms, s.text from segments s
        where s.meeting_id = m.id and to_tsvector('simple', s.text) @@ q.q
        order by s.idx limit 1
      ) hit on true
      where m.id in (${sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`);
    const out = new Map<string, SearchMatch>();
    for (const r of result.rows) {
      const base = { speaker: null, startMs: null, hits: r.hits };
      if (r.seg_snippet) out.set(r.id, { in: 'transcript', snippet: r.seg_snippet, speaker: r.seg_speaker, startMs: r.seg_start, hits: r.hits });
      else if (r.notes_snippet) out.set(r.id, { ...base, in: 'notes', snippet: r.notes_snippet });
      else if (r.title_hit) out.set(r.id, { ...base, in: 'title', snippet: await this.headline(`${r.title}. ${r.description ?? ''}`, tsq, opts) });
      else out.set(r.id, { ...base, in: 'people', snippet: await this.headline(r.people, tsq, opts) });
    }
    return out;
  }

  private async headline(text: string, tsq: string, opts: string): Promise<string> {
    const r = await this.db.execute<{ h: string }>(sql`select ts_headline('simple', ${text}, to_tsquery('simple', ${tsq}), ${opts}) as h`);
    return r.rows[0]?.h ?? text;
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
    await this.db.transaction(async (tx) => {
      const [gone] = await tx.delete(meetings).where(eq(meetings.id, id)).returning({ chainId: meetings.chainId });
      if (gone?.chainId) await dissolveIfAlone(tx, gone.chainId);
    });
  }

  // ---- chains

  /** The user's other finished meetings within CHAIN_WINDOW_DAYS of `around`, nearest first, not taken out of a chain by hand. */
  async chainCandidates(userId: string, meetingId: string, around: Date, limit: number): Promise<ChainCandidateRow[]> {
    const at = around.toISOString();
    return this.db
      .select({
        id: meetings.id,
        title: meetings.title,
        description: meetings.description,
        startedAt: meetings.startedAt,
        speakers: meetings.speakers,
        topics: meetings.topics,
        chainId: meetings.chainId,
      })
      .from(meetings)
      .where(
        and(
          eq(meetings.userId, userId),
          ne(meetings.id, meetingId),
          eq(meetings.status, 'ready'),
          ne(meetings.source, 'demo'),
          eq(meetings.chainLocked, false),
          sql`${meetings.startedAt} between ${at}::timestamptz - make_interval(days => ${CHAIN_WINDOW_DAYS}) and ${at}::timestamptz + make_interval(days => ${CHAIN_WINDOW_DAYS})`,
        ),
      )
      .orderBy(sql`abs(extract(epoch from ${meetings.startedAt} - ${at}::timestamptz))`)
      .limit(limit);
  }

  /** The meetings of a chain, oldest first. */
  async chainMeetings(userId: string, chainId: string): Promise<MeetingRef[]> {
    const rows = await this.db
      .select({ id: meetings.id, title: meetings.title, startedAt: meetings.startedAt })
      .from(meetings)
      .where(and(eq(meetings.userId, userId), eq(meetings.chainId, chainId)))
      .orderBy(asc(meetings.startedAt), asc(meetings.id));
    return rows.map((r) => ({ ...r, startedAt: r.startedAt.toISOString() }));
  }

  /**
   * Puts a meeting in the chain of `targetId` (starting one with the target when it has none),
   * leaving the chain it was in. `locked` marks a choice the user made, which the summarizer keeps.
   */
  async joinChain(meetingId: string, targetId: string, opts: { reason: string | null; locked: boolean }): Promise<MeetingRow> {
    return this.db.transaction(async (tx) => {
      const [target] = await tx.select({ chainId: meetings.chainId }).from(meetings).where(eq(meetings.id, targetId)).for('update');
      let chainId = target?.chainId ?? null;
      if (!chainId) {
        chainId = randomUUID();
        await tx.update(meetings).set({ chainId, chainReason: null }).where(eq(meetings.id, targetId));
      }
      const [before] = await tx.select({ chainId: meetings.chainId }).from(meetings).where(eq(meetings.id, meetingId)).for('update');
      const [row] = await tx
        .update(meetings)
        .set({ chainId, chainReason: opts.reason, ...(opts.locked ? { chainLocked: true } : {}) })
        .where(eq(meetings.id, meetingId))
        .returning();
      if (before?.chainId && before.chainId !== chainId) await dissolveIfAlone(tx, before.chainId);
      return row;
    });
  }

  /** Takes a meeting out of its chain for good (the summarizer won't link it again); a chain left with one meeting ends. */
  async leaveChain(meetingId: string): Promise<MeetingRow> {
    return this.db.transaction(async (tx) => {
      const [before] = await tx.select({ chainId: meetings.chainId }).from(meetings).where(eq(meetings.id, meetingId)).for('update');
      const [row] = await tx.update(meetings).set({ chainId: null, chainReason: null, chainLocked: true }).where(eq(meetings.id, meetingId)).returning();
      if (before?.chainId) await dissolveIfAlone(tx, before.chainId);
      return row;
    });
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
    const { legacyActionItems: _legacy, search: _search, ...summary } = row;
    return { ...summary, actionItems: await this.getActionItems(meetingId) };
  }

  async getActionItems(meetingId: string): Promise<ActionItem[]> {
    return this.db.select(ITEM_COLUMNS).from(actionItems).where(eq(actionItems.meetingId, meetingId)).orderBy(asc(actionItems.idx));
  }

  /** Stores a summary and replaces the meeting's action items, in one transaction. */
  async saveSummary(meetingId: string, { actionItems: items, ...values }: SummaryValues, patch: MeetingPatch): Promise<MeetingRow> {
    return this.db.transaction(async (tx) => {
      const row = { meetingId, ...values, search: sql`to_tsvector('simple', ${summaryDocument({ ...values, actionItems: items })})`, createdAt: new Date() };
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

/** A chain needs two meetings; the last one left on its own leaves it. */
async function dissolveIfAlone(tx: Tx, chainId: string): Promise<void> {
  const left = await tx.select({ id: meetings.id }).from(meetings).where(eq(meetings.chainId, chainId)).limit(2);
  if (left.length === 1) await tx.update(meetings).set({ chainId: null, chainReason: null }).where(eq(meetings.id, left[0].id));
}
