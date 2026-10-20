import { z } from 'zod';
import { DeviceApp } from './device';

/** Why the report was sent: the user asked, or the app noticed it had been stuck. */
export const ProblemReportKind = z.enum(['user', 'hang']);
export type ProblemReportKind = z.infer<typeof ProblemReportKind>;

/** The desktop apps' logs are cut to their newest part above this many characters. */
export const PROBLEM_REPORT_LOG_LIMIT = 1_000_000;

/**
 * Sent by the Mac and Windows apps' "Report a Problem…": what the user wrote, plus what the app knows about
 * itself (version, macOS, audio devices, recorder state) and its own recent log.
 */
export const ProblemReportRequest = z.object({
  kind: ProblemReportKind.default('user'),
  /** What went wrong, in the user's words. May be empty for a hang the app noticed itself. */
  message: z.string().trim().max(4000).default(''),
  app: z.object({
    version: z.string().min(1).max(40),
    build: z.string().max(40).default(''),
    flavor: DeviceApp,
  }),
  /** e.g. "macOS 26.2 (25C56)" and "Mac15,3", or "Windows 11 Pro 23H2 (10.0.22631)" and "LENOVO 21HM". */
  system: z.object({
    os: z.string().max(120),
    model: z.string().max(120).default(''),
  }),
  /** Short facts as text: "recorder.phase": "recording", "mic.device": "MacBook Pro Microphone", … */
  diagnostics: z
    .record(z.string().max(80), z.string().max(2000))
    .refine((value) => Object.keys(value).length <= 100, 'At most 100 diagnostics')
    .default({}),
  /** The app's own log lines, newest last. */
  log: z.string().max(PROBLEM_REPORT_LOG_LIMIT).default(''),
});
export type ProblemReportRequest = z.infer<typeof ProblemReportRequest>;

export const ProblemReportResponse = z.object({
  id: z.string().uuid(),
  receivedAt: z.string().datetime(),
});
export type ProblemReportResponse = z.infer<typeof ProblemReportResponse>;

// ---- reading reports (admins only)

export const ListProblemReportsQuery = z.object({
  /** One user's: their id or email address (any case). */
  user: z.string().trim().min(1).max(320).optional(),
  kind: ProblemReportKind.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListProblemReportsQuery = z.infer<typeof ListProblemReportsQuery>;

/** A report in the list: everything but its diagnostics and log. */
export const ProblemReportSummary = z.object({
  id: z.string().uuid(),
  kind: ProblemReportKind,
  message: z.string(),
  user: z.object({ id: z.string().uuid(), email: z.string().nullable() }),
  /** The desktop app that sent it; null when sent from a dashboard session or the device was removed. */
  deviceId: z.string().uuid().nullable(),
  app: z.object({ version: z.string(), build: z.string(), flavor: DeviceApp }),
  system: z.object({ os: z.string(), model: z.string() }),
  logBytes: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});
export type ProblemReportSummary = z.infer<typeof ProblemReportSummary>;

export const ProblemReportPage = z.object({
  items: z.array(ProblemReportSummary),
  nextCursor: z.string().nullable(),
});
export type ProblemReportPage = z.infer<typeof ProblemReportPage>;

/** One report in full. */
export const ProblemReportDetail = ProblemReportSummary.extend({
  diagnostics: z.record(z.string(), z.string()),
  log: z.string(),
});
export type ProblemReportDetail = z.infer<typeof ProblemReportDetail>;
