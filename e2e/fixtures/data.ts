import { randomUUID } from 'node:crypto';
import { AdminUserDetail, Device, LatestDownload, Me, MeetingDetail, MeetingListItem, type AdminOverview, type Segment } from '@boringtalks/shared';

/** Fixtures are parsed with the shared contract, so a schema change breaks them loudly. */

export const AUDIO_URL = 'https://media.mock.test/demo.wav';
export const UPLOAD_HOST = 'https://r2.mock.test';

export function me(overrides: Partial<Me> = {}): Me {
  return Me.parse({
    id: randomUUID(),
    email: 'reviewer@example.com',
    name: null,
    emailOnReady: true,
    createdAt: new Date('2026-10-01T09:00:00Z').toISOString(),
    ...overrides,
  });
}

export const DEMO_SEGMENTS: Segment[] = [
  { speaker: 'You', startMs: 0, endMs: 4200, text: 'Okay, everyone here? Let’s keep this one short.' },
  { speaker: 'Speaker 1', startMs: 4600, endMs: 9800, text: 'Famous last words. So, pricing. Are we really moving Pro to twenty-nine?' },
  { speaker: 'You', startMs: 10200, endMs: 15800, text: 'Yes. Twenty-nine a month, and annual stays at two forty so nobody feels robbed.' },
  { speaker: 'Speaker 2', startMs: 16300, endMs: 21900, text: 'Then the launch email has to go out before November third.' },
  { speaker: 'Speaker 2', startMs: 22300, endMs: 25000, text: 'I can write it by the thirtieth.' },
  { speaker: 'Speaker 1', startMs: 25800, endMs: 31200, text: 'And someone updates the pricing page, or support gets a very long week.' },
  { speaker: 'You', startMs: 31800, endMs: 36500, text: 'That’s me. Pricing page by November second.' },
  { speaker: 'Speaker 1', startMs: 37000, endMs: 42500, text: 'Great. Does anyone have anything else, or can we end four minutes early?' },
  { speaker: 'You', startMs: 43000, endMs: 46000, text: 'Ending early. Historic.' },
];

/** The local calendar date `days` from today, "YYYY-MM-DD". */
export function dayFromToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return new Intl.DateTimeFormat('en-CA').format(d);
}

export function demoMeeting(overrides: Partial<MeetingDetail> = {}): MeetingDetail {
  return MeetingDetail.parse({
    id: randomUUID(),
    title: 'Pricing review: Pro to $29, launch Nov 3',
    description: 'Pro goes from $24 to $29 a month from November 3rd; annual stays at $240. Launch email and pricing page have owners.',
    status: 'ready',
    source: 'demo',
    startedAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
    durationSec: 46,
    speakers: ['You', 'Speaker 1', 'Speaker 2'],
    topics: ['Pricing', 'Launch Planning'],
    actionItemCount: 2,
    hasAudio: true,
    language: 'en',
    error: null,
    summary: {
      summary:
        'The team agreed to raise the Pro plan from $24 to $29 a month starting November 3rd. The annual plan stays at $240, which keeps existing yearly customers happy.\n\nThe launch email goes out before the change, and the pricing page is updated a day ahead.',
      keyTopics: ['Pro pricing', 'Annual plan', 'Launch timing'],
      actionItems: [
        // Due dates relative to today, so the tasks page always has something overdue and something upcoming.
        { id: 'ai-1', text: 'Write the launch email', owner: 'Speaker 2', due: 'yesterday', dueDate: dayFromToday(-1), done: false },
        { id: 'ai-2', text: 'Update the pricing page', owner: 'You', due: 'next week', dueDate: dayFromToday(10), done: false },
      ],
      decisions: ['Pro is $29/month from Nov 3', 'Annual plan stays at $240'],
      model: 'anthropic/claude-haiku-4.5',
    },
    segments: DEMO_SEGMENTS,
    audioUrl: AUDIO_URL,
    ...overrides,
  });
}

export function processingMeeting(source: 'browser' | 'upload', title: string | null): MeetingDetail {
  return MeetingDetail.parse({
    id: randomUUID(),
    title: title || 'Untitled meeting',
    description: null,
    status: 'recording',
    source,
    startedAt: new Date().toISOString(),
    durationSec: null,
    speakers: [],
    topics: [],
    actionItemCount: 0,
    hasAudio: false,
    language: null,
    error: null,
    summary: null,
    segments: [],
    audioUrl: null,
  });
}

export function toListItem(m: MeetingDetail): MeetingListItem {
  return MeetingListItem.parse({
    id: m.id,
    title: m.title,
    description: m.description,
    status: m.status,
    source: m.source,
    startedAt: m.startedAt,
    durationSec: m.durationSec,
    speakers: m.speakers,
    topics: m.topics,
    actionItemCount: m.summary?.actionItems.length ?? m.actionItemCount,
    hasAudio: m.hasAudio,
  });
}

export function device(name = 'Mike’s MacBook Pro'): Device {
  return Device.parse({
    id: randomUUID(),
    name,
    createdAt: new Date(Date.now() - 3 * 86400_000).toISOString(),
    lastSeenAt: new Date(Date.now() - 3600_000).toISOString(),
  });
}

export function latestDownload(overrides: Partial<LatestDownload> = {}): LatestDownload {
  return LatestDownload.parse({
    platform: 'macos',
    version: '1.0.3',
    build: '42',
    url: 'https://download.boringtalks.lol/BoringTalks-1.0.3.dmg',
    sizeBytes: 18_400_000,
    minimumOs: '26.0',
    notarized: true,
    publishedAt: '2026-10-05T12:00:00.000Z',
    ...overrides,
  });
}

export function windowsDownload(overrides: Partial<LatestDownload> = {}): LatestDownload {
  return LatestDownload.parse({
    platform: 'windows',
    version: '0.1.0',
    build: '61',
    url: 'https://download.boringtalks.lol/BoringTalks-Setup-0.1.0.exe',
    sizeBytes: 92_000_000,
    minimumOs: '10.0.19041',
    notarized: false,
    publishedAt: '2026-10-12T12:00:00.000Z',
    ...overrides,
  });
}

/** A silent mono 8 kHz 16-bit WAV, so the audio element has something to seek in. */
export function silentWav(seconds = 50): Buffer {
  const rate = 8000;
  const samples = rate * seconds;
  const data = samples * 2;
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + data, 4);
  b.write('WAVE', 8);
  b.write('fmt ', 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(data, 40);
  return b;
}

/** Usage across accounts for the admin overview: a few meetings a day for `days` days. */
export function adminOverview(days: number): AdminOverview {
  const today = new Date();
  const daily = Array.from({ length: days }, (_, i) => {
    const d = new Date(today.getTime() - (days - 1 - i) * 86_400_000);
    return { date: d.toISOString().slice(0, 10), meetings: i % 4, hours: (i % 4) * 0.75, signups: i % 7 === 0 ? 1 : 0 };
  });
  return {
    days,
    tz: 'UTC',
    users: { total: 42, new7d: 3, newInWindow: 9, active1d: 5, active7d: 17, active30d: 30, admins: 1 },
    meetings: {
      total: 310,
      totalHours: 205.5,
      inWindow: daily.reduce((n, d) => n + d.meetings, 0),
      hoursInWindow: daily.reduce((n, d) => n + d.hours, 0),
      bySource: { macos: 20, windows: 14, browser: 6, upload: 3, demo: 0 },
      byStatus: { recording: 0, uploaded: 0, transcribing: 1, summarizing: 0, ready: 40, failed: 2 },
      failureRate: 0.048,
    },
    devices: { active30d: 21, versions: [{ platform: 'windows', version: '0.6.0', count: 12 }, { platform: 'macos', version: '0.6.0', count: 9 }] },
    reports: { last7d: 2, hangs7d: 1 },
    costs: { summaryInputTokens: 900_000, summaryOutputTokens: 70_000, summaryUsd: 1.25, serverTranscribedHours: 6, transcriptionUsd: 0.6, storageGb: 1.4, storageUsdPerMonth: 0.02 },
    daily,
  };
}

/** One account as the admin dashboard sees it. */
export function adminUser(overrides: Partial<AdminUserDetail> = {}): AdminUserDetail {
  return AdminUserDetail.parse({
    id: randomUUID(),
    email: 'ann@example.com',
    name: 'Ann Lee',
    createdAt: '2026-10-01T09:00:00.000Z',
    lastActiveAt: new Date().toISOString(),
    meetingCount: 12,
    recordedMinutes: 540,
    lastMeetingAt: new Date().toISOString(),
    apps: [{ platform: 'windows', version: '0.6.0' }],
    isAdmin: false,
    isOwner: false,
    recordingLimitMinutes: null,
    effectiveRecordingLimitMinutes: 120,
    adminGrantedBy: null,
    last30d: { meetings: 8, recordedMinutes: 360, failed: 1 },
    devices: [{ id: randomUUID(), name: 'Ann’s PC', platform: 'windows', appVersion: '0.6.0', createdAt: '2026-10-01T09:00:00.000Z', lastSeenAt: new Date().toISOString(), revokedAt: null }],
    meetings: [{ id: randomUUID(), startedAt: new Date().toISOString(), source: 'windows', status: 'ready', durationSec: 2700, audioBytes: 32_000_000, error: null }],
    reports: [],
    ...overrides,
  });
}
