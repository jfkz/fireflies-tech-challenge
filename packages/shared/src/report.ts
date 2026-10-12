import { z } from 'zod';
import { DeviceApp } from './device';

/** Why the report was sent: the user asked, or the app noticed it had been stuck. */
export const ProblemReportKind = z.enum(['user', 'hang']);
export type ProblemReportKind = z.infer<typeof ProblemReportKind>;

/** The Mac app's log is cut to its newest part above this many characters. */
export const PROBLEM_REPORT_LOG_LIMIT = 1_000_000;

/**
 * Sent by the Mac app's "Report a Problem…": what the user wrote, plus what the app knows about
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
  /** e.g. "macOS 26.2 (25C56)" and "Mac15,3". */
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
