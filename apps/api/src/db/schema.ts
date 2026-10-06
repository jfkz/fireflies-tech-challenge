import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
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
import type { ActionItem, MeetingSource, MeetingStatus } from '@boringtalks/shared';

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

const createdAt = () => timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow();

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  firebaseUid: text('firebase_uid').notNull().unique(),
  email: text('email'),
  name: text('name'),
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
    transcriptKey: text('transcript_key'),
    /** Distinct speakers in order of appearance, cached for the list view. */
    speakers: text('speakers').array().notNull().default(sql`'{}'::text[]`),
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

export const summaries = pgTable('summaries', {
  meetingId: uuid('meeting_id')
    .primaryKey()
    .references(() => meetings.id, { onDelete: 'cascade' }),
  summary: text('summary').notNull(),
  keyTopics: jsonb('key_topics').$type<string[]>().notNull(),
  actionItems: jsonb('action_items').$type<ActionItem[]>().notNull(),
  decisions: jsonb('decisions').$type<string[]>().notNull(),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  createdAt: createdAt(),
});

export const emailLog = pgTable('email_log', {
  idempotencyKey: text('idempotency_key').primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export type UserRow = typeof users.$inferSelect;
export type DeviceRow = typeof devices.$inferSelect;
export type MeetingRow = typeof meetings.$inferSelect;
export type SegmentRow = typeof segments.$inferSelect;
export type SummaryRow = typeof summaries.$inferSelect;
