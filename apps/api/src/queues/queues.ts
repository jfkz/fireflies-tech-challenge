export const TRANSCRIBE_QUEUE = 'transcribe';
export const SUMMARIZE_QUEUE = 'summarize';
export const EMAIL_QUEUE = 'email';
/** Fetches a finished meeting bot's transcript and audio from Recall.ai. */
export const BOT_IMPORT_QUEUE = 'bot-import';

/**
 * Recall finishes the transcript a few minutes after the bot leaves, so the import retries
 * once a minute for about 20 minutes before giving up.
 */
export const BOT_IMPORT_JOB_OPTIONS = { attempts: 20, backoff: { type: 'fixed', delay: 60_000 } } as const;

export interface MeetingJob {
  meetingId: string;
  /** The meeting's `attempts` when this run started; older runs are ignored. */
  run: number;
}

export type EmailJob =
  | { type: 'welcome'; userId: string }
  | { type: 'meeting-ready'; userId: string; meetingId: string; run: number }
  | { type: 'device-connected'; userId: string; deviceId: string };

/**
 * BullMQ job ids must not contain ':', so the documented `<meetingId>:<stage>:<run>`
 * is spelled with underscores. The run number makes a reprocess a new job while
 * retries and duplicate enqueues of the same run collapse into one.
 */
export const meetingJobId = (meetingId: string, stage: string, run: number): string => `${meetingId}_${stage}_${run}`;

export function emailJobId(job: EmailJob): string {
  switch (job.type) {
    case 'welcome':
      return `welcome_${job.userId}`;
    case 'meeting-ready':
      return `meeting-ready_${job.meetingId}_${job.run}`;
    case 'device-connected':
      return `device-connected_${job.deviceId}`;
  }
}

export const DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { count: 1_000 },
  removeOnFail: { count: 5_000 },
} as const;
