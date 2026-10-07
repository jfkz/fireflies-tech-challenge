import type { Segment } from '@boringtalks/shared';
import { AppConfig } from '../config/config.module';
import { parseEnv } from '../config/env';
import type { MeetingRow, UserRow } from '../db/schema';

export const BASE_ENV = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://x',
  REDIS_URL: 'redis://x',
  FIREBASE_PROJECT_ID: 'bt-test',
  R2_ENDPOINT: 'http://storage.internal:9000',
  R2_ACCESS_KEY_ID: 'key',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_BUCKET: 'bucket',
} as const;

export function testConfig(overrides: Record<string, string | undefined> = {}): AppConfig {
  return new AppConfig(parseEnv({ ...BASE_ENV, ...overrides }));
}

export function user(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    firebaseUid: 'fb-1',
    email: 'ann@example.com',
    name: 'Ann',
    nameLocked: false,
    emailOnReady: true,
    createdAt: new Date('2026-10-01T10:00:00Z'),
    ...overrides,
  };
}

export function meeting(overrides: Partial<MeetingRow> = {}): MeetingRow {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    userId: user().id,
    title: 'Meeting on Oct 6, 14:05',
    titleLocked: false,
    description: null,
    status: 'recording',
    source: 'macos',
    startedAt: new Date('2026-10-06T14:05:00Z'),
    durationSec: null,
    language: null,
    audioKey: null,
    audioContentType: null,
    hasAudio: false,
    transcriptKey: null,
    speakers: [],
    speakerNames: {},
    topics: [],
    error: null,
    attempts: 0,
    botId: null,
    botStatus: null,
    botMeetingUrl: null,
    botJoinAt: null,
    clientKey: null,
    search: null,
    createdAt: new Date('2026-10-06T14:05:00Z'),
    updatedAt: new Date('2026-10-06T14:05:00Z'),
    ...overrides,
  };
}

export const seg = (speaker: string, startMs: number, endMs: number, text: string): Segment => ({ speaker, startMs, endMs, text });
