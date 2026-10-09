import type { Segment } from '@boringtalks/shared';

/** The microphone side of a split-channel Mac recording: the user, as the Mac labels them too. */
export const YOU = 'You';

/** The two sides' phrases may be cut a little differently; this much apart still counts as the same time. */
const ECHO_SLACK_MS = 1500;
/** A microphone phrase that repeats this share of the other side's words is its echo. */
const ECHO_SHARE = 0.6;

/**
 * One transcript from the two sides of a split-channel recording, the way the Mac assembles its
 * own: the microphone is "You", the system side keeps its speakers. Without headphones the
 * microphone also hears the call, so a microphone phrase at the same time as the others that
 * repeats most of their words is that echo, and is dropped.
 */
export function mergeChannels(mic: Segment[], system: Segment[]): Segment[] {
  const mine = mic.filter((s) => !isEcho(s, system)).map((s) => ({ ...s, speaker: YOU }));
  return [...system, ...mine].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs || (a.speaker === YOU ? 1 : 0) - (b.speaker === YOU ? 1 : 0));
}

/** Same rule as the Mac's `SegmentAssembler.isEcho`. */
export function isEcho(mic: Segment, system: Segment[]): boolean {
  const micWords = words(mic.text);
  if (micWords.length === 0) return false;
  const nearby = system.filter((s) => s.startMs <= mic.endMs + ECHO_SLACK_MS && s.endMs >= mic.startMs - ECHO_SLACK_MS);
  if (nearby.length === 0) return false;
  const heard = new Set(nearby.flatMap((s) => words(s.text)));
  const repeated = micWords.filter((w) => heard.has(w)).length;
  return repeated / micWords.length >= ECHO_SHARE;
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}
