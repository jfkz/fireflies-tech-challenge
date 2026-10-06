import { randomUUID } from 'node:crypto';
import { Device, LatestDownload, Me, MeetingDetail, MeetingListItem, type Segment } from '@boringtalks/shared';

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
        { id: 'ai-1', text: 'Write the launch email', owner: 'Speaker 2', due: 'Oct 30', done: false },
        { id: 'ai-2', text: 'Update the pricing page', owner: 'You', due: 'Nov 2', done: false },
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
