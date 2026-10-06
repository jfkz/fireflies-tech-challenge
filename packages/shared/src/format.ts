import type { Segment } from './meeting';

/** "1:05:09", "4:07", "0:09" */
export function formatTimestamp(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** "1 h 5 min", "42 min", "under a minute" */
export function formatDuration(sec: number | null | undefined): string {
  if (sec == null) return '—';
  if (sec < 60) return 'under a minute';
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** Speakers in order of first appearance. */
export function speakersOf(segments: readonly Segment[]): string[] {
  const seen = new Set<string>();
  for (const s of segments) seen.add(s.speaker);
  return [...seen];
}

/**
 * Orders segments from both channels by time and joins consecutive pieces of
 * the same speaker that are less than `gapMs` apart, so the transcript reads
 * as turns rather than phrase fragments.
 */
export function mergeSegments(segments: readonly Segment[], gapMs = 1500): Segment[] {
  const sorted = [...segments].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const out: Segment[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && last.speaker === s.speaker && s.startMs - last.endMs <= gapMs) {
      out[out.length - 1] = { ...last, endMs: Math.max(last.endMs, s.endMs), text: `${last.text} ${s.text}` };
    } else {
      out.push({ ...s });
    }
  }
  return out;
}

/** Plain-text transcript for the summarizer: "[4:07] Speaker 1: text". */
export function transcriptText(segments: readonly Segment[]): string {
  return segments.map((s) => `[${formatTimestamp(s.startMs)}] ${s.speaker}: ${s.text}`).join('\n');
}

/** Index of the segment playing at `ms`, or -1. */
export function segmentAt(segments: readonly Segment[], ms: number): number {
  let lo = 0;
  let hi = segments.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segments[mid].startMs <= ms) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** Label → display name, e.g. { "Speaker 1": "Maya", "You": "Mike" }. Labels without an entry keep their label. */
export type SpeakerNames = Readonly<Record<string, string>>;

/** The display name for a raw speaker label. */
export function speakerName(label: string, names: SpeakerNames): string {
  return Object.hasOwn(names, label) ? names[label] : label;
}

/** Segments with their raw labels replaced by display names. */
export function applySpeakerNames(segments: readonly Segment[], names: SpeakerNames): Segment[] {
  return segments.map((s) => ({ ...s, speaker: speakerName(s.speaker, names) }));
}
