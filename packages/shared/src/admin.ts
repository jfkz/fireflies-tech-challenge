import { z } from 'zod';
import { DevicePlatform } from './device';
import { MeetingSource, MeetingStatus } from './meeting';
import { ProblemReportSummary } from './report';

/** The longest recording the apps allow unless an admin changes it, in minutes. */
export const DEFAULT_RECORDING_LIMIT_MINUTES = 120;
/** A day: the most an admin can set (0 turns the limit off). */
export const MAX_RECORDING_LIMIT_MINUTES = 24 * 60;

/** Minutes: 0 = no limit. */
const LimitMinutes = z.number().int().min(0).max(MAX_RECORDING_LIMIT_MINUTES);

const IsoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Count = z.number().int().nonnegative();

// ---- overview

export const AdminOverviewQuery = z.object({
  /** The window the "in the last N days" numbers and the daily series cover. */
  days: z.coerce.number().int().min(7).max(365).default(30),
  /** IANA time zone the days are counted in. */
  tz: z.string().min(1).max(64).default('UTC'),
});
export type AdminOverviewQuery = z.infer<typeof AdminOverviewQuery>;

export const AdminDay = z.object({
  date: IsoDay,
  signups: Count,
  meetings: Count,
  /** Recorded hours of the meetings started that day. */
  hours: z.number().nonnegative(),
});
export type AdminDay = z.infer<typeof AdminDay>;

export const AdminOverview = z.object({
  days: z.number().int(),
  tz: z.string(),
  users: z.object({
    total: Count,
    new7d: Count,
    newInWindow: Count,
    active1d: Count,
    active7d: Count,
    active30d: Count,
    admins: Count,
  }),
  meetings: z.object({
    total: Count,
    totalHours: z.number().nonnegative(),
    inWindow: Count,
    hoursInWindow: z.number().nonnegative(),
    /** Meetings in the window by where they were recorded. */
    bySource: z.record(MeetingSource, Count),
    /** Meetings in the window by status. */
    byStatus: z.record(MeetingStatus, Count),
    /** Failed ÷ finished (ready + failed) in the window; null with none finished. */
    failureRate: z.number().min(0).max(1).nullable(),
  }),
  devices: z.object({
    /** Connected (not revoked) computers seen in the last 30 days. */
    active30d: Count,
    /** By platform and app version, most first. */
    versions: z.array(z.object({ platform: DevicePlatform.nullable(), version: z.string().nullable(), count: Count })),
  }),
  reports: z.object({ last7d: Count, hangs7d: Count }),
  /** What the window cost, estimated (docs/COSTS.md rates). */
  costs: z.object({
    summaryInputTokens: Count,
    summaryOutputTokens: Count,
    summaryUsd: z.number().nonnegative(),
    serverTranscribedHours: z.number().nonnegative(),
    transcriptionUsd: z.number().nonnegative(),
    /** All audio kept now, and what it costs a month. */
    storageGb: z.number().nonnegative(),
    storageUsdPerMonth: z.number().nonnegative(),
  }),
  daily: z.array(AdminDay),
  /** The PostHog project, for funnels and retention; null when not set up. */
  analyticsUrl: z.string().url().nullable().optional(),
});
export type AdminOverview = z.infer<typeof AdminOverview>;

// ---- users

export const ListAdminUsersQuery = z.object({
  /** Part of an email or name, or a user id. */
  q: z.string().trim().min(1).max(320).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListAdminUsersQuery = z.infer<typeof ListAdminUsersQuery>;

export const AdminDevicePlatform = z.object({ platform: DevicePlatform, version: z.string().nullable() });

export const AdminUserSummary = z.object({
  id: z.string().uuid(),
  email: z.string().nullable(),
  name: z.string().nullable(),
  createdAt: z.string().datetime(),
  lastActiveAt: z.string().datetime().nullable(),
  meetingCount: Count,
  recordedMinutes: Count,
  lastMeetingAt: z.string().datetime().nullable(),
  /** The desktop apps connected now. */
  apps: z.array(AdminDevicePlatform),
  isAdmin: z.boolean(),
  isOwner: z.boolean(),
  /** null = the global default, 0 = no limit. */
  recordingLimitMinutes: LimitMinutes.nullable(),
});
export type AdminUserSummary = z.infer<typeof AdminUserSummary>;

export const AdminUserPage = z.object({
  items: z.array(AdminUserSummary),
  nextCursor: z.string().nullable(),
});
export type AdminUserPage = z.infer<typeof AdminUserPage>;

/** A meeting as admins see it: never its title, transcript or summary. */
export const AdminMeeting = z.object({
  id: z.string().uuid(),
  startedAt: z.string().datetime(),
  source: MeetingSource,
  status: MeetingStatus,
  durationSec: z.number().int().nonnegative().nullable(),
  audioBytes: z.number().int().nonnegative().nullable(),
  error: z.string().nullable(),
});
export type AdminMeeting = z.infer<typeof AdminMeeting>;

export const AdminDevice = z.object({
  id: z.string().uuid(),
  name: z.string(),
  platform: DevicePlatform.nullable(),
  appVersion: z.string().nullable(),
  createdAt: z.string().datetime(),
  lastSeenAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
});
export type AdminDevice = z.infer<typeof AdminDevice>;

export const AdminUserDetail = AdminUserSummary.extend({
  /** What the apps enforce for them now, in minutes; null = no limit. */
  effectiveRecordingLimitMinutes: LimitMinutes.nullable(),
  adminGrantedBy: z.object({ id: z.string().uuid(), email: z.string().nullable() }).nullable(),
  last30d: z.object({ meetings: Count, recordedMinutes: Count, failed: Count }),
  devices: z.array(AdminDevice),
  /** The newest 20. */
  meetings: z.array(AdminMeeting),
  /** The newest 10. */
  reports: z.array(ProblemReportSummary),
});
export type AdminUserDetail = z.infer<typeof AdminUserDetail>;

export const UpdateAdminUserRequest = z
  .object({
    isAdmin: z.boolean().optional(),
    /** null = back to the global default, 0 = no limit. */
    recordingLimitMinutes: LimitMinutes.nullable().optional(),
  })
  .refine((v) => v.isAdmin !== undefined || v.recordingLimitMinutes !== undefined, { message: 'Nothing to update' });
export type UpdateAdminUserRequest = z.infer<typeof UpdateAdminUserRequest>;

// ---- admins and settings

export const AdminPerson = z.object({
  /** null: an owner who hasn't signed in yet. */
  id: z.string().uuid().nullable(),
  email: z.string().nullable(),
  name: z.string().nullable(),
  isOwner: z.boolean(),
});
export type AdminPerson = z.infer<typeof AdminPerson>;

export const AdminList = z.object({ admins: z.array(AdminPerson) });
export type AdminList = z.infer<typeof AdminList>;

/** Makes an existing account an admin. */
export const GrantAdminRequest = z.object({ email: z.string().trim().email().max(320) });
export type GrantAdminRequest = z.infer<typeof GrantAdminRequest>;

export const AdminSettings = z.object({
  /** For everyone without a limit of their own; 0 = no limit. */
  recordingLimitMinutes: LimitMinutes,
  updatedAt: z.string().datetime().nullable(),
  updatedBy: z.string().nullable(),
});
export type AdminSettings = z.infer<typeof AdminSettings>;

export const UpdateAdminSettingsRequest = z.object({ recordingLimitMinutes: LimitMinutes });
export type UpdateAdminSettingsRequest = z.infer<typeof UpdateAdminSettingsRequest>;

/** The limit in force: the user's own if set, else the global one; 0 means none (null). In minutes. */
export function effectiveRecordingLimit(userMinutes: number | null, globalMinutes: number): number | null {
  const minutes = userMinutes ?? globalMinutes;
  return minutes > 0 ? minutes : null;
}
