import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { AudioChannels, DeviceApp, MeetingSource, MeetingStatus, ProblemReportKind } from '@boringtalks/shared';

/** Who named a speaker: the summarizer from the conversation, or the user by hand (never overwritten). */
export interface SpeakerNameEntry {
  name: string;
  by: 'ai' | 'user';
  /** The summarizer found no name and gave a role ("Recruiter"): not a person to link across meetings. */
  role?: true;
}
/** Raw transcript label ("You", "Speaker 1") → its display name. */
export type SpeakerNameMap = Record<string, SpeakerNameEntry>;

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

const createdAt = () => timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow();

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  firebaseUid: text('firebase_uid').notNull().unique(),
  email: text('email'),
  name: text('name'),
  /** The user typed their name in settings, so sign-ins stop overwriting it with the provider's. */
  nameLocked: boolean('name_locked').notNull().default(false),
  emailOnReady: boolean('email_on_ready').notNull().default(true),
  createdAt: createdAt(),
});

export const devices = pgTable(
  'devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: createdAt(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [index('devices_user_idx').on(t.userId)],
);

export const deviceCodes = pgTable('device_codes', {
  codeHash: text('code_hash').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  codeChallenge: text('code_challenge').notNull(),
  deviceName: text('device_name').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true, mode: 'date' }),
});

export const meetings = pgTable(
  'meetings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    /** Set when the user chose the title, so the summarizer leaves it alone. */
    titleLocked: boolean('title_locked').notNull().default(false),
    description: text('description'),
    status: text('status').$type<MeetingStatus>().notNull(),
    source: text('source').$type<MeetingSource>().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }).notNull(),
    durationSec: integer('duration_sec'),
    language: text('language'),
    audioKey: text('audio_key'),
    audioContentType: text('audio_content_type'),
    /** True once the audio object was seen in storage (HeadObject). */
    hasAudio: boolean('has_audio').notNull().default(false),
    /** 'mic-system' when the Mac recorded the microphone and system audio on separate channels; null = mixed. */
    audioChannels: text('audio_channels').$type<AudioChannels>(),
    /** A mono mix of a split-channel recording, made by the worker for playback. */
    playbackKey: text('playback_key'),
    transcriptKey: text('transcript_key'),
    /** Distinct speakers' display names in order of appearance, cached for the list view and the speaker filter. */
    speakers: text('speakers').array().notNull().default(sql`'{}'::text[]`),
    /** Display names for the raw labels in `segments.speaker`; segments keep their labels so renames never lose data. */
    speakerNames: jsonb('speaker_names').$type<SpeakerNameMap>().notNull().default({}),
    /** Short reusable tags from the summary, for the topic filter. */
    topics: text('topics').array().notNull().default(sql`'{}'::text[]`),
    /** Related meetings share a chain id (the summarizer links a follow-up to the meeting it continues). */
    chainId: uuid('chain_id'),
    /** Why the summarizer linked it; null when linked by hand. */
    chainReason: text('chain_reason'),
    /** The user linked or unlinked it by hand: the summarizer leaves its chain alone. */
    chainLocked: boolean('chain_locked').notNull().default(false),
    error: text('error'),
    /** Processing runs started; part of the job id so a reprocess is a new job. */
    attempts: integer('attempts').notNull().default(0),
    /** The client's Idempotency-Key from POST /meetings, so a retried create returns the same meeting. */
    clientKey: text('client_key'),
    search: tsvector('search').generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, ''))`,
    ),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('meetings_user_started_idx').on(t.userId, t.startedAt.desc(), t.id.desc()),
    index('meetings_search_idx').using('gin', t.search),
    index('meetings_speakers_idx').using('gin', t.speakers),
    index('meetings_topics_idx').using('gin', t.topics),
    index('meetings_user_chain_idx').on(t.userId, t.chainId),
    uniqueIndex('meetings_user_client_key_idx').on(t.userId, t.clientKey),
  ],
);

export const segments = pgTable(
  'segments',
  {
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    idx: integer('idx').notNull(),
    speaker: text('speaker').notNull(),
    startMs: integer('start_ms').notNull(),
    endMs: integer('end_ms').notNull(),
    text: text('text').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.meetingId, t.idx] }),
    index('segments_text_search_idx').using('gin', sql`to_tsvector('simple', ${t.text})`),
  ],
);

export const summaries = pgTable(
  'summaries',
  {
  meetingId: uuid('meeting_id')
    .primaryKey()
    .references(() => meetings.id, { onDelete: 'cascade' }),
  summary: text('summary').notNull(),
  keyTopics: jsonb('key_topics').$type<string[]>().notNull(),
  /**
   * @deprecated Action items moved to their own table. Kept (nullable) for one release so the
   * previous version keeps working during a deploy; a later migration drops it.
   */
  legacyActionItems: jsonb('action_items').$type<unknown[]>(),
  decisions: jsonb('decisions').$type<string[]>().notNull(),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  /** Summary, key topics, decisions and action items, for search; written with the summary. */
  search: tsvector('search'),
  createdAt: createdAt(),
  },
  (t) => [index('summaries_search_idx').using('gin', t.search)],
);

/**
 * Action items, one row each, so tasks from every meeting can be listed in due-date order.
 * Rewritten as a whole with each summary; `done` and `owner` change in place.
 */
export const actionItems = pgTable(
  'action_items',
  {
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    /** Short id from the summarizer run; unique within the meeting. */
    id: text('id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Order within the meeting's summary. */
    idx: integer('idx').notNull(),
    text: text('text').notNull(),
    owner: text('owner'),
    /** The deadline as said ("Friday"). */
    due: text('due'),
    /** The deadline as a date, for sorting; null when none was given. */
    dueDate: date('due_date', { mode: 'string' }),
    done: boolean('done').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.meetingId, t.id] }),
    // The tasks page: a user's open (or done) items, soonest due first.
    index('action_items_user_due_idx').on(t.userId, t.done, t.dueDate),
  ],
);

export const emailLog = pgTable('email_log', {
  idempotencyKey: text('idempotency_key').primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

/** "Report a Problem…" from the Mac app (or a hang it noticed itself), with its diagnostics and log. */
export const problemReports = pgTable(
  'problem_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'set null' }),
    kind: text('kind').$type<ProblemReportKind>().notNull(),
    message: text('message').notNull().default(''),
    appVersion: text('app_version').notNull(),
    appBuild: text('app_build').notNull().default(''),
    flavor: text('flavor').$type<DeviceApp>().notNull(),
    os: text('os').notNull(),
    model: text('model').notNull().default(''),
    diagnostics: jsonb('diagnostics').$type<Record<string, string>>().notNull().default({}),
    log: text('log').notNull().default(''),
    createdAt: createdAt(),
  },
  (t) => [index('problem_reports_created_idx').on(t.createdAt), index('problem_reports_user_idx').on(t.userId)],
);

export type UserRow = typeof users.$inferSelect;
export type DeviceRow = typeof devices.$inferSelect;
export type MeetingRow = typeof meetings.$inferSelect;
export type SegmentRow = typeof segments.$inferSelect;
export type SummaryRow = typeof summaries.$inferSelect;
export type ActionItemRow = typeof actionItems.$inferSelect;
export type ProblemReportRow = typeof problemReports.$inferSelect;
