import type { Segment } from '@boringtalks/shared';
import type { RecallTranscriptEntry } from './recall.client';

/** A participant with no name in the call becomes "Speaker <n>" so names can still be guessed later. */
export function participantLabel(p: RecallTranscriptEntry['participant'], order: Map<number, number>): string {
  const name = p.name?.trim();
  if (name) return name.slice(0, 80);
  if (!order.has(p.id)) order.set(p.id, order.size + 1);
  return `Speaker ${order.get(p.id)}`;
}

/**
 * Recall's transcript (blocks of words per participant, in order, times in seconds from the start
 * of the recording) as our segments. Participants are named as they appear in the call, so the
 * speakers arrive with real names.
 */
export function recallToSegments(entries: readonly RecallTranscriptEntry[]): Segment[] {
  const order = new Map<number, number>();
  const segments: Segment[] = [];
  for (const entry of entries) {
    const words = entry.words.filter((w) => w.text.trim());
    if (words.length === 0) continue;
    const text = words
      .map((w) => w.text.trim())
      .join(' ')
      .replace(/\s+([,.!?;:])/g, '$1')
      .slice(0, 10_000);
    const startMs = Math.max(0, Math.round(words[0].start_timestamp.relative * 1000));
    const last = words[words.length - 1];
    const endMs = Math.max(startMs, Math.round((last.end_timestamp?.relative ?? last.start_timestamp.relative) * 1000));
    segments.push({ speaker: participantLabel(entry.participant, order), startMs, endMs, text });
  }
  return segments.sort((a, b) => a.startMs - b.startMs);
}

/** The language most of the transcript is in, as a short code ("en"), when Recall says. */
export function recallLanguage(entries: readonly RecallTranscriptEntry[]): string | null {
  const count = new Map<string, number>();
  for (const e of entries) if (e.language_code) count.set(e.language_code, (count.get(e.language_code) ?? 0) + e.words.length);
  const top = [...count].sort((a, b) => b[1] - a[1])[0]?.[0];
  return top ? top.split('-')[0].toLowerCase().slice(0, 16) : null;
}
