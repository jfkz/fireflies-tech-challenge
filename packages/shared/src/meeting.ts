import { z } from 'zod';

/** Where a meeting came from. */
export const MeetingSource = z.enum(['macos', 'browser', 'upload', 'demo']);
export type MeetingSource = z.infer<typeof MeetingSource>;

/**
 * Lifecycle of a meeting. A Mac recording arrives with its transcript and goes
 * straight to `summarizing`; browser recordings and uploads go through
 * `transcribing` on the server first.
 */
export const MeetingStatus = z.enum([
  'recording',
  'uploaded',
  'transcribing',
  'summarizing',
  'ready',
  'failed',
]);
export type MeetingStatus = z.infer<typeof MeetingStatus>;

/** Statuses a meeting may move to from each status. */
export const MEETING_TRANSITIONS: Record<MeetingStatus, readonly MeetingStatus[]> = {
  recording: ['uploaded', 'summarizing', 'failed'],
  uploaded: ['transcribing', 'summarizing', 'failed'],
  transcribing: ['summarizing', 'failed'],
  summarizing: ['ready', 'failed'],
  // Reprocessing a meeting the server transcribed starts from its audio again.
  ready: ['transcribing', 'summarizing'],
  failed: ['transcribing', 'summarizing'],
};

export function canTransition(from: MeetingStatus, to: MeetingStatus): boolean {
  return MEETING_TRANSITIONS[from].includes(to);
}

/** A stretch of speech by one speaker. Times are milliseconds from the meeting start. */
export const Segment = z
  .object({
    speaker: z.string().trim().min(1).max(80),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().nonnegative(),
    text: z.string().trim().min(1).max(10_000),
  })
  .refine((s) => s.endMs >= s.startMs, { message: 'endMs must not be before startMs', path: ['endMs'] });
export type Segment = z.infer<typeof Segment>;

/** A calendar date, "2026-10-09". */
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date like 2026-10-09');

export const ActionItem = z.object({
  id: z.string(),
  text: z.string().min(1),
  owner: z.string().nullable(),
  /** The deadline as it was said ("Friday", "end of month"). */
  due: z.string().nullable(),
  /** The same deadline as a date, resolved against the meeting's date; null when none was given. */
  dueDate: IsoDate.nullable().default(null),
  done: z.boolean(),
});
export type ActionItem = z.infer<typeof ActionItem>;

/** What the summarizer produces for a meeting. */
export const MeetingSummary = z.object({
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(300),
  summary: z.string().min(1),
  keyTopics: z.array(z.string()).max(12),
  actionItems: z.array(ActionItem),
  decisions: z.array(z.string()),
  model: z.string(),
});
export type MeetingSummary = z.infer<typeof MeetingSummary>;

/** Where a search hit a meeting: the first matching transcript line, or else its notes or title. */
export const SearchMatch = z.object({
  in: z.enum(['transcript', 'notes', 'title', 'people']),
  /** Text around the match; matched words are wrapped in ⟦ ⟧. */
  snippet: z.string(),
  speaker: z.string().nullable(),
  startMs: z.number().int().nonnegative().nullable(),
  /** Transcript lines that match. */
  hits: z.number().int().nonnegative(),
});
export type SearchMatch = z.infer<typeof SearchMatch>;

/** One row of the meeting list. */
export const MeetingListItem = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  status: MeetingStatus,
  source: MeetingSource,
  startedAt: z.string().datetime(),
  durationSec: z.number().int().nonnegative().nullable(),
  /** Display names in order of appearance: names found in the conversation, else "Speaker 1"… */
  speakers: z.array(z.string()),
  /** Short reusable tags ("Pricing", "Hiring") for filtering across meetings. */
  topics: z.array(z.string()),
  actionItemCount: z.number().int().nonnegative(),
  hasAudio: z.boolean(),
  /** With a search: where the meeting matched, with the words marked ⟦like this⟧. */
  match: SearchMatch.nullable().optional(),
});
export type MeetingListItem = z.infer<typeof MeetingListItem>;

/** Another meeting, as a link: in the same chain, or the same day. */
export const MeetingRef = z.object({
  id: z.string().uuid(),
  title: z.string(),
  startedAt: z.string().datetime(),
});
export type MeetingRef = z.infer<typeof MeetingRef>;

/**
 * Related meetings linked into one chain (a recurring sync, follow-ups on one project), oldest first.
 * Linked by the summarizer when a meeting continues an earlier one, or by hand.
 */
export const MeetingChain = z.object({
  id: z.string().uuid(),
  meetings: z.array(MeetingRef).min(2),
  /**
   * What connects them ("Follows up on the admin page plan"): why this meeting was linked, else why
   * the nearest other one was, so every meeting of the chain shows it; null when all were linked by hand.
   */
  reason: z.string().nullable(),
});
export type MeetingChain = z.infer<typeof MeetingChain>;

export const MeetingDetail = MeetingListItem.extend({
  language: z.string().nullable(),
  error: z.string().nullable(),
  summary: MeetingSummary.omit({ title: true, description: true }).nullable(),
  segments: z.array(Segment),
  audioUrl: z.string().url().nullable(),
  /** The chain this meeting is part of, or null. */
  chain: MeetingChain.nullable().optional(),
});
export type MeetingDetail = z.infer<typeof MeetingDetail>;

export const MeetingPage = z.object({
  items: z.array(MeetingListItem),
  nextCursor: z.string().nullable(),
});
export type MeetingPage = z.infer<typeof MeetingPage>;

// ---- requests ----

export const CreateMeetingRequest = z.object({
  title: z.string().trim().max(120).optional(),
  source: MeetingSource.exclude(['demo']),
  startedAt: z.string().datetime().optional(),
  language: z.string().max(16).optional(),
});
export type CreateMeetingRequest = z.infer<typeof CreateMeetingRequest>;

export const AUDIO_CONTENT_TYPES = ['audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/wav'] as const;
/** 200 MB: about 14 hours of the Mac app's 32 kbps AAC, or a long uploaded file. */
export const MAX_AUDIO_BYTES = 200 * 1024 * 1024;

/**
 * How the recording's channels are laid out. `mixed`: everyone in one mix (mono or plain stereo).
 * `mic-system`: the Mac's microphone (the user) on the left channel and what the Mac played (everyone
 * else) on the right, so the server can transcribe each side on its own and keep "You" apart.
 */
export const AUDIO_CHANNELS = ['mixed', 'mic-system'] as const;
export const AudioChannels = z.enum(AUDIO_CHANNELS);
export type AudioChannels = z.infer<typeof AudioChannels>;

export const UploadUrlRequest = z.object({
  contentType: z.enum(AUDIO_CONTENT_TYPES),
  sizeBytes: z.number().int().positive().max(MAX_AUDIO_BYTES),
  channels: AudioChannels.optional(),
});
export type UploadUrlRequest = z.infer<typeof UploadUrlRequest>;

export const UploadUrlResponse = z.object({
  url: z.string().url(),
  key: z.string(),
  headers: z.record(z.string(), z.string()),
  expiresInSec: z.number().int(),
});
export type UploadUrlResponse = z.infer<typeof UploadUrlResponse>;

/** 6 hours of back-to-back phrases is well under this. */
export const MAX_SEGMENTS = 20_000;

export const TranscriptUpload = z.object({
  language: z.string().max(16).optional(),
  durationSec: z.number().int().nonnegative().optional(),
  segments: z.array(Segment).min(1).max(MAX_SEGMENTS),
});
export type TranscriptUpload = z.infer<typeof TranscriptUpload>;

export const CompleteMeetingRequest = z.object({
  durationSec: z.number().int().nonnegative().optional(),
});
export type CompleteMeetingRequest = z.infer<typeof CompleteMeetingRequest>;

export const SpeakerName = z.string().trim().min(1).max(80);

export const UpdateMeetingRequest = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    actionItem: z.object({ id: z.string(), done: z.boolean() }).optional(),
    /** Renames speakers: current display name → new name. */
    speakers: z
      .record(SpeakerName, SpeakerName)
      .refine((r) => Object.keys(r).length > 0 && Object.keys(r).length <= 20, { message: 'Rename 1 to 20 speakers at a time' })
      .optional(),
    /** null takes the meeting out of its chain (and it won't be linked again by itself); `with` links it to that meeting's chain. */
    chain: z.union([z.null(), z.object({ with: z.string().uuid() })]).optional(),
  })
  .refine((v) => v.title !== undefined || v.actionItem !== undefined || v.speakers !== undefined || v.chain !== undefined, {
    message: 'Nothing to update',
  });
export type UpdateMeetingRequest = z.infer<typeof UpdateMeetingRequest>;

export const ListMeetingsQuery = z
  .object({
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    q: z.string().trim().max(200).optional(),
    /** Only meetings this person spoke in (display name, exact). */
    speaker: z.string().trim().min(1).max(80).optional(),
    /** Only meetings with this topic (case-insensitive). */
    topic: z.string().trim().min(1).max(60).optional(),
    /** Started at or after (inclusive) / before (exclusive). */
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
  })
  .refine((v) => !v.from || !v.to || Date.parse(v.from) < Date.parse(v.to), { message: '`from` must be before `to`', path: ['to'] });
export type ListMeetingsQuery = z.infer<typeof ListMeetingsQuery>;

/** A speaker or topic with how many meetings it appears in, for the filter bar. */
export const FacetCount = z.object({ value: z.string(), count: z.number().int().positive() });
export type FacetCount = z.infer<typeof FacetCount>;

/** The most frequent speakers and topics across a user's meetings. */
export const MeetingFacets = z.object({
  speakers: z.array(FacetCount),
  topics: z.array(FacetCount),
});
export type MeetingFacets = z.infer<typeof MeetingFacets>;

// ---- tasks: action items from every meeting

export const TaskItem = ActionItem.extend({
  meeting: z.object({ id: z.string().uuid(), title: z.string(), startedAt: z.string().datetime() }),
});
export type TaskItem = z.infer<typeof TaskItem>;

export const TaskPage = z.object({
  items: z.array(TaskItem),
  nextCursor: z.string().nullable(),
});
export type TaskPage = z.infer<typeof TaskPage>;

export const ListTasksQuery = z.object({
  /** open (default), done, or all. Open tasks come soonest due first, then those without a date. */
  status: z.enum(['open', 'done', 'all']).default('open'),
  /** Only tasks owned by this person (display name, exact). */
  owner: z.string().trim().min(1).max(80).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type ListTasksQuery = z.infer<typeof ListTasksQuery>;

// ---- calendar: how much time went into meetings

export const MeetingStatsQuery = z
  .object({
    from: IsoDate,
    /** Exclusive. */
    to: IsoDate,
    /** IANA time zone the days are counted in, e.g. "Europe/Berlin". */
    tz: z.string().min(1).max(64).default('UTC'),
  })
  .refine((v) => v.from < v.to, { message: '`from` must be before `to`', path: ['to'] })
  .refine((v) => Date.parse(v.to) - Date.parse(v.from) <= 400 * 86_400_000, { message: 'At most 400 days at a time', path: ['to'] });
export type MeetingStatsQuery = z.infer<typeof MeetingStatsQuery>;

export const DayStats = z.object({ date: IsoDate, count: z.number().int().positive(), totalSec: z.number().int().nonnegative() });
export type DayStats = z.infer<typeof DayStats>;

/** Days with at least one meeting, oldest first. */
export const MeetingStats = z.object({
  tz: z.string(),
  days: z.array(DayStats),
});
export type MeetingStats = z.infer<typeof MeetingStats>;
