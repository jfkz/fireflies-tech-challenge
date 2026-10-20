import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  effectiveRecordingLimit,
  MeetingSource,
  MeetingStatus,
  type AdminDay,
  type AdminList,
  type AdminOverview,
  type AdminOverviewQuery,
  type AdminSettings,
  type AdminUserDetail,
  type AdminUserPage,
  type AdminUserSummary,
  type ListAdminUsersQuery,
  type UpdateAdminSettingsRequest,
  type UpdateAdminUserRequest,
} from '@boringtalks/shared';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { decodeCursor, encodeCursor } from '../common/cursor';
import { validationError } from '../common/zod.pipe';
import { AppConfig } from '../config/config.module';
import type { DeviceRow, UserRow } from '../db/schema';
import { isTimeZone } from '../meetings/meetings.service';
import { ReportsRepository } from '../reports/reports.repository';
import { toSummary as toReportSummary } from '../reports/reports.service';
import { AdminRepository, type DayCount, type UserListRow } from './admin.repository';

/** List prices from docs/COSTS.md, in dollars. */
export const PRICES = {
  summaryInputPerMillion: 1,
  summaryOutputPerMillion: 5,
  /** MAI-Transcribe 2, per hour of each transcribed channel. */
  transcriptionPerChannelHour: 0.1,
  storagePerGbMonth: 0.015,
};

const GB = 1024 ** 3;
const round = (n: number, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits;

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly config: AppConfig,
    private readonly repo: AdminRepository,
    private readonly settings: AppSettingsService,
    private readonly reports: ReportsRepository,
  ) {}

  // ---- overview

  async overview(query: AdminOverviewQuery, now = new Date()): Promise<AdminOverview> {
    if (!isTimeZone(query.tz)) throw validationError([{ path: 'tz', message: 'Unknown time zone' }]);
    const windowStart = new Date(now.getTime() - query.days * 86_400_000);
    const firstDay = addDays(localDay(now, query.tz), 1 - query.days);
    const [userCounts, totals, bySource, byStatus, tokens, deviceStats, reportCounts, perDay, signups, admins] = await Promise.all([
      this.repo.userCounts(windowStart),
      this.repo.meetingTotals(windowStart),
      this.repo.meetingsBySource(windowStart),
      this.repo.meetingsByStatus(windowStart),
      this.repo.summaryTokens(windowStart),
      this.repo.deviceStats(),
      this.repo.reportCounts(),
      this.repo.meetingsPerDay(firstDay, query.tz),
      this.repo.signupsPerDay(firstDay, query.tz),
      this.admins(),
    ]);
    const finished = totals.readyInWindow + totals.failedInWindow;
    const storageGb = totals.storageBytes / GB;
    const serverHours = totals.serverChannelSecInWindow / 3600;
    return {
      days: query.days,
      tz: query.tz,
      users: { ...userCounts, admins: admins.admins.length },
      meetings: {
        total: totals.total,
        totalHours: round(totals.totalSec / 3600, 1),
        inWindow: totals.inWindow,
        hoursInWindow: round(totals.secInWindow / 3600, 1),
        bySource: counts(MeetingSource.options, bySource),
        byStatus: counts(MeetingStatus.options, byStatus),
        failureRate: finished > 0 ? round(totals.failedInWindow / finished, 3) : null,
      },
      devices: deviceStats,
      reports: reportCounts,
      costs: {
        summaryInputTokens: tokens.input,
        summaryOutputTokens: tokens.output,
        summaryUsd: round((tokens.input * PRICES.summaryInputPerMillion + tokens.output * PRICES.summaryOutputPerMillion) / 1_000_000),
        serverTranscribedHours: round(serverHours, 1),
        transcriptionUsd: round(serverHours * PRICES.transcriptionPerChannelHour),
        storageGb: round(storageGb, 3),
        storageUsdPerMonth: round(storageGb * PRICES.storagePerGbMonth),
      },
      daily: dailySeries(firstDay, query.days, perDay, signups),
    };
  }

  // ---- users

  async listUsers(query: ListAdminUsersQuery): Promise<AdminUserPage> {
    const before = query.cursor ? decodeCursor(query.cursor) : null;
    if (query.cursor && !before) throw validationError([{ path: 'cursor', message: 'Invalid cursor' }]);
    const rows = await this.repo.listUsers({ q: query.q, before, limit: query.limit + 1 });
    const page = rows.slice(0, query.limit);
    const apps = groupDevices(await this.repo.activeDevices(page.map((u) => u.id)));
    const last = page[page.length - 1];
    return {
      items: page.map((u) => this.summary(u, apps.get(u.id) ?? [])),
      nextCursor: rows.length > query.limit && last ? encodeCursor({ startedAt: last.createdAt, id: last.id }) : null,
    };
  }

  async user(id: string): Promise<AdminUserDetail> {
    const row = await this.repo.findUser(id);
    if (!row) throw new NotFoundException('User not found');
    const [devices, last30d, meetingRows, reportRows, global, grantedBy] = await Promise.all([
      this.repo.userDevices(id),
      this.repo.userLast30d(id),
      this.repo.userMeetings(id, 20),
      this.reports.list({ user: id, limit: 10 }),
      this.settings.recordingLimitMinutes(),
      row.adminGrantedBy ? this.repo.findUser(row.adminGrantedBy) : null,
    ]);
    return {
      ...this.summary(row, devices.filter((d) => !d.revokedAt)),
      effectiveRecordingLimitMinutes: effectiveRecordingLimit(row.recordingLimitMinutes, global),
      adminGrantedBy: grantedBy ? { id: grantedBy.id, email: grantedBy.email } : null,
      last30d: { meetings: last30d.meetings, recordedMinutes: Math.round(last30d.recordedSec / 60), failed: last30d.failed },
      devices: devices.map((d) => ({
        id: d.id,
        name: d.name,
        platform: d.platform,
        appVersion: d.appVersion,
        createdAt: d.createdAt.toISOString(),
        lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
        revokedAt: d.revokedAt?.toISOString() ?? null,
      })),
      meetings: meetingRows.map((m) => ({ ...m, startedAt: m.startedAt.toISOString() })),
      reports: reportRows.map(toReportSummary),
    };
  }

  /** Admin rights and the recording limit. Owners keep their rights, and nobody removes their own. */
  async updateUser(actor: UserRow, id: string, body: UpdateAdminUserRequest): Promise<AdminUserDetail> {
    const target = await this.repo.findUser(id);
    if (!target) throw new NotFoundException('User not found');
    if (body.isAdmin === false) {
      if (this.config.isOwner(target.email)) throw new ConflictException(`${target.email} is an owner (ADMIN_EMAILS on the API); remove them there`);
      if (target.id === actor.id) throw new ConflictException("You can't remove your own admin rights");
    }
    if (body.isAdmin !== undefined && body.isAdmin !== target.isAdmin) {
      await this.repo.setAdmin(id, body.isAdmin, actor.id);
      this.logger.log({ actorId: actor.id, userId: id, isAdmin: body.isAdmin }, 'admin rights changed');
    }
    if (body.recordingLimitMinutes !== undefined) {
      await this.repo.setRecordingLimit(id, body.recordingLimitMinutes);
      this.logger.log({ actorId: actor.id, userId: id, recordingLimitMinutes: body.recordingLimitMinutes }, 'recording limit changed');
    }
    return this.user(id);
  }

  // ---- admins

  async admins(): Promise<AdminList> {
    const owners = this.config.env.ADMIN_EMAILS;
    const [ownerRows, dashboard] = await Promise.all([this.repo.findUsersByEmails(owners), this.repo.dashboardAdmins()]);
    const ownerByEmail = new Map(ownerRows.map((u) => [u.email?.toLowerCase(), u]));
    const list: AdminList['admins'] = owners.map((email) => {
      const row = ownerByEmail.get(email);
      return { id: row?.id ?? null, email: row?.email ?? email, name: row?.name ?? null, isOwner: true };
    });
    const listed = new Set(list.map((a) => a.id).filter(Boolean));
    for (const u of dashboard) {
      if (!listed.has(u.id)) list.push({ id: u.id, email: u.email, name: u.name, isOwner: false });
    }
    return { admins: list };
  }

  /** Makes an existing account an admin: one must have signed in, so nobody can claim an address first. */
  async grantAdmin(actor: UserRow, email: string): Promise<AdminList> {
    const target = await this.repo.findUserByEmail(email);
    if (!target) throw new NotFoundException('No account with that email yet. They need to sign in to BoringTalks once first.');
    if (!target.isAdmin) {
      await this.repo.setAdmin(target.id, true, actor.id);
      this.logger.log({ actorId: actor.id, userId: target.id, isAdmin: true }, 'admin rights changed');
    }
    return this.admins();
  }

  // ---- settings

  async getSettings(): Promise<AdminSettings> {
    const row = await this.settings.recordingLimitRow();
    const by = row?.updatedBy ? await this.repo.findUser(row.updatedBy) : null;
    return {
      recordingLimitMinutes: await this.settings.recordingLimitMinutes(),
      updatedAt: row?.updatedBy ? row.updatedAt.toISOString() : null,
      updatedBy: by?.email ?? null,
    };
  }

  async updateSettings(actor: UserRow, body: UpdateAdminSettingsRequest): Promise<AdminSettings> {
    await this.settings.setRecordingLimitMinutes(body.recordingLimitMinutes, actor.id);
    this.logger.log({ actorId: actor.id, recordingLimitMinutes: body.recordingLimitMinutes }, 'global recording limit changed');
    return this.getSettings();
  }

  private summary(u: UserListRow, devices: DeviceRow[]): AdminUserSummary {
    const isOwner = this.config.isOwner(u.email);
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      createdAt: u.createdAt.toISOString(),
      lastActiveAt: u.lastActiveAt?.toISOString() ?? null,
      meetingCount: u.meetingCount,
      recordedMinutes: Math.round(u.recordedSec / 60),
      lastMeetingAt: u.lastMeetingAt?.toISOString() ?? null,
      apps: devices.filter((d) => d.platform).map((d) => ({ platform: d.platform!, version: d.appVersion })),
      isAdmin: isOwner || u.isAdmin,
      isOwner,
      recordingLimitMinutes: u.recordingLimitMinutes,
    };
  }
}

/** Every key with its count, zero when absent. */
function counts<K extends string>(keys: readonly K[], rows: { key: K; count: number }[]): Record<K, number> {
  const out = Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
  for (const r of rows) out[r.key] = r.count;
  return out;
}

function groupDevices(rows: DeviceRow[]): Map<string, DeviceRow[]> {
  const map = new Map<string, DeviceRow[]>();
  for (const d of rows) map.set(d.userId, [...(map.get(d.userId) ?? []), d]);
  return map;
}

/** "2026-10-20" for `at` in `tz`. */
export function localDay(at: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** One entry per day from `first`, zeros where nothing happened. */
export function dailySeries(first: string, days: number, meetingsPerDay: DayCount[], signupsPerDay: DayCount[]): AdminDay[] {
  const meetings = new Map(meetingsPerDay.map((d) => [d.date, d]));
  const signups = new Map(signupsPerDay.map((d) => [d.date, d.count]));
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(first, i);
    const m = meetings.get(date);
    return { date, signups: signups.get(date) ?? 0, meetings: m?.count ?? 0, hours: round((m?.totalSec ?? 0) / 3600, 2) };
  });
}
