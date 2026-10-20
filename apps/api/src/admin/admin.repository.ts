import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import type { MeetingSource, MeetingStatus } from '@boringtalks/shared';
import type { MeetingCursor } from '../common/cursor';
import { InjectDb, type Database } from '../db/db.module';
import { devices, meetings, problemReports, summaries, users, type DeviceRow, type UserRow } from '../db/schema';

/** Demo meetings are seeded for every new account: never usage. */
const notDemo = ne(meetings.source, 'demo');
/** Transcribed on the server (browser, upload, a desktop recording sent for online transcription), in channel-seconds. */
const serverChannelSec = sql`${meetings.durationSec} * case when ${meetings.audioChannels} = 'mic-system' then 2 else 1 end`;
const serverTranscribed = sql`${meetings.hasAudio} and (${meetings.source} in ('browser', 'upload') or ${meetings.audioChannels} = 'mic-system')`;

const since = (date: Date) => sql`${date.toISOString()}::timestamptz`;
const int = (expr: SQL) => sql<number>`(${expr})::int`;

export interface UserListRow extends UserRow {
  meetingCount: number;
  recordedSec: number;
  lastMeetingAt: Date | null;
}

export interface DayCount {
  date: string;
  count: number;
  totalSec: number;
}

/** Read-only numbers across every account, and the few writes admins make. */
@Injectable()
export class AdminRepository {
  constructor(@InjectDb() private readonly db: Database) {}

  async userCounts(windowStart: Date) {
    const [row] = await this.db
      .select({
        total: int(sql`count(*)`),
        new7d: int(sql`count(*) filter (where ${users.createdAt} > now() - interval '7 days')`),
        newInWindow: int(sql`count(*) filter (where ${users.createdAt} >= ${since(windowStart)})`),
        active1d: int(sql`count(*) filter (where ${users.lastActiveAt} > now() - interval '1 day')`),
        active7d: int(sql`count(*) filter (where ${users.lastActiveAt} > now() - interval '7 days')`),
        active30d: int(sql`count(*) filter (where ${users.lastActiveAt} > now() - interval '30 days')`),
      })
      .from(users);
    return row;
  }

  async meetingTotals(windowStart: Date) {
    const inWindow = sql`${meetings.startedAt} >= ${since(windowStart)}`;
    const [row] = await this.db
      .select({
        total: int(sql`count(*)`),
        totalSec: int(sql`coalesce(sum(${meetings.durationSec}), 0)`),
        inWindow: int(sql`count(*) filter (where ${inWindow})`),
        secInWindow: int(sql`coalesce(sum(${meetings.durationSec}) filter (where ${inWindow}), 0)`),
        readyInWindow: int(sql`count(*) filter (where ${inWindow} and ${meetings.status} = 'ready')`),
        failedInWindow: int(sql`count(*) filter (where ${inWindow} and ${meetings.status} = 'failed')`),
        serverChannelSecInWindow: int(sql`coalesce(sum(${serverChannelSec}) filter (where ${inWindow} and ${serverTranscribed}), 0)`),
        storageBytes: sql<number>`coalesce(sum(${meetings.audioBytes}) filter (where ${meetings.hasAudio}), 0)::float8`,
      })
      .from(meetings)
      .where(notDemo);
    return row;
  }

  async meetingsBySource(windowStart: Date): Promise<{ key: MeetingSource; count: number }[]> {
    return this.db
      .select({ key: meetings.source, count: int(sql`count(*)`) })
      .from(meetings)
      .where(and(notDemo, sql`${meetings.startedAt} >= ${since(windowStart)}`))
      .groupBy(meetings.source);
  }

  async meetingsByStatus(windowStart: Date): Promise<{ key: MeetingStatus; count: number }[]> {
    return this.db
      .select({ key: meetings.status, count: int(sql`count(*)`) })
      .from(meetings)
      .where(and(notDemo, sql`${meetings.startedAt} >= ${since(windowStart)}`))
      .groupBy(meetings.status);
  }

  async summaryTokens(windowStart: Date) {
    const [row] = await this.db
      .select({
        input: int(sql`coalesce(sum(${summaries.inputTokens}), 0)`),
        output: int(sql`coalesce(sum(${summaries.outputTokens}), 0)`),
      })
      .from(summaries)
      .where(sql`${summaries.createdAt} >= ${since(windowStart)}`);
    return row;
  }

  async deviceStats() {
    const [active] = await this.db
      .select({ active30d: int(sql`count(*)`) })
      .from(devices)
      .where(and(isNull(devices.revokedAt), sql`${devices.lastSeenAt} > now() - interval '30 days'`));
    const versions = await this.db
      .select({ platform: devices.platform, version: devices.appVersion, count: int(sql`count(*)`) })
      .from(devices)
      .where(isNull(devices.revokedAt))
      .groupBy(devices.platform, devices.appVersion)
      .orderBy(desc(sql`count(*)`))
      .limit(20);
    return { active30d: active.active30d, versions };
  }

  async reportCounts() {
    const [row] = await this.db
      .select({
        last7d: int(sql`count(*)`),
        hangs7d: int(sql`count(*) filter (where ${problemReports.kind} = 'hang')`),
      })
      .from(problemReports)
      .where(sql`${problemReports.createdAt} > now() - interval '7 days'`);
    return row;
  }

  /** Meetings (and their seconds) per local day in `tz`, from the day `from` on. */
  async meetingsPerDay(from: string, tz: string): Promise<DayCount[]> {
    const day = sql`(${meetings.startedAt} at time zone ${tz})::date`;
    return this.db
      .select({ date: sql<string>`to_char(${day}, 'YYYY-MM-DD')`, count: int(sql`count(*)`), totalSec: int(sql`coalesce(sum(${meetings.durationSec}), 0)`) })
      .from(meetings)
      .where(and(notDemo, sql`${meetings.startedAt} >= (${from}::timestamp at time zone ${tz})`))
      // By position: the time zone is a separate bind parameter in each clause.
      .groupBy(sql`1`)
      .orderBy(sql`1`);
  }

  async signupsPerDay(from: string, tz: string): Promise<DayCount[]> {
    const day = sql`(${users.createdAt} at time zone ${tz})::date`;
    return this.db
      .select({ date: sql<string>`to_char(${day}, 'YYYY-MM-DD')`, count: int(sql`count(*)`), totalSec: sql<number>`0` })
      .from(users)
      .where(sql`${users.createdAt} >= (${from}::timestamp at time zone ${tz})`)
      .groupBy(sql`1`)
      .orderBy(sql`1`);
  }

  // ---- users

  /** Newest accounts first. `q` is part of an email or name, or a user id. */
  async listUsers(opts: { q?: string; before?: MeetingCursor | null; limit: number }): Promise<UserListRow[]> {
    const filters: SQL[] = [];
    if (opts.q) {
      if (UUID.test(opts.q)) {
        filters.push(eq(users.id, opts.q));
      } else {
        const like = `%${opts.q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        filters.push(or(sql`lower(${users.email}) like ${like}`, sql`lower(${users.name}) like ${like}`)!);
      }
    }
    const created = sql`date_trunc('milliseconds', ${users.createdAt})`;
    if (opts.before) filters.push(sql`(${created}, ${users.id}) < (${opts.before.startedAt.toISOString()}::timestamptz, ${opts.before.id}::uuid)`);
    const own = sql`${meetings.userId} = ${users.id} and ${meetings.source} <> 'demo'`;
    return this.db
      .select({
        ...userColumns,
        meetingCount: int(sql`(select count(*) from ${meetings} where ${own})`),
        recordedSec: int(sql`(select coalesce(sum(${meetings.durationSec}), 0) from ${meetings} where ${own})`),
        lastMeetingAt: sql<Date | null>`(select max(${meetings.startedAt}) from ${meetings} where ${own})`.mapWith((v: string | Date | null) =>
          v === null ? null : new Date(v),
        ),
      })
      .from(users)
      .where(and(...filters))
      .orderBy(desc(created), desc(users.id))
      .limit(opts.limit);
  }

  /** Connected (not revoked) devices of these users. */
  async activeDevices(userIds: string[]): Promise<DeviceRow[]> {
    if (userIds.length === 0) return [];
    return this.db
      .select()
      .from(devices)
      .where(and(inArray(devices.userId, userIds), isNull(devices.revokedAt)));
  }

  async findUser(id: string): Promise<UserListRow | null> {
    const [row] = await this.listUsers({ q: id, limit: 1 });
    return row ?? null;
  }

  async findUserByEmail(email: string): Promise<UserRow | null> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
      .orderBy(users.createdAt)
      .limit(1);
    return row ?? null;
  }

  async findUsersByEmails(emails: string[]): Promise<UserRow[]> {
    if (emails.length === 0) return [];
    return this.db
      .select()
      .from(users)
      .where(inArray(sql`lower(${users.email})`, emails.map((e) => e.toLowerCase())));
  }

  async dashboardAdmins(): Promise<UserRow[]> {
    return this.db.select().from(users).where(eq(users.isAdmin, true)).orderBy(users.email);
  }

  async userLast30d(userId: string) {
    const [row] = await this.db
      .select({
        meetings: int(sql`count(*)`),
        recordedSec: int(sql`coalesce(sum(${meetings.durationSec}), 0)`),
        failed: int(sql`count(*) filter (where ${meetings.status} = 'failed')`),
      })
      .from(meetings)
      .where(and(eq(meetings.userId, userId), notDemo, sql`${meetings.startedAt} > now() - interval '30 days'`));
    return row;
  }

  async userDevices(userId: string): Promise<DeviceRow[]> {
    return this.db.select().from(devices).where(eq(devices.userId, userId)).orderBy(desc(devices.createdAt));
  }

  /** Metadata only: never titles, transcripts or summaries. */
  async userMeetings(userId: string, limit: number) {
    return this.db
      .select({
        id: meetings.id,
        startedAt: meetings.startedAt,
        source: meetings.source,
        status: meetings.status,
        durationSec: meetings.durationSec,
        audioBytes: meetings.audioBytes,
        error: meetings.error,
      })
      .from(meetings)
      .where(and(eq(meetings.userId, userId), notDemo))
      .orderBy(desc(meetings.startedAt), desc(meetings.id))
      .limit(limit);
  }

  async setAdmin(userId: string, isAdmin: boolean, by: string): Promise<UserRow | null> {
    const [row] = await this.db.update(users).set({ isAdmin, adminGrantedBy: by }).where(eq(users.id, userId)).returning();
    return row ?? null;
  }

  async setRecordingLimit(userId: string, minutes: number | null): Promise<UserRow | null> {
    const [row] = await this.db.update(users).set({ recordingLimitMinutes: minutes }).where(eq(users.id, userId)).returning();
    return row ?? null;
  }
}

const userColumns = {
  id: users.id,
  firebaseUid: users.firebaseUid,
  email: users.email,
  name: users.name,
  nameLocked: users.nameLocked,
  emailOnReady: users.emailOnReady,
  isAdmin: users.isAdmin,
  adminGrantedBy: users.adminGrantedBy,
  recordingLimitMinutes: users.recordingLimitMinutes,
  lastActiveAt: users.lastActiveAt,
  createdAt: users.createdAt,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

