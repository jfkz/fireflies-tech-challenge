import type { Segment } from '@boringtalks/shared';

export interface TranscribeInput {
  audio: Uint8Array;
  mediaType: string;
  language: string | null;
}

export interface TranscribeResult {
  segments: Segment[];
  language: string | null;
  durationSec: number | null;
}

/**
 * Server-side fallback ASR for meetings that arrive without a transcript.
 * Audio is a single mixed channel, so there is no diarization: every segment
 * is attributed to "Speaker 1".
 */
export abstract class Transcriber {
  abstract transcribe(input: TranscribeInput): Promise<TranscribeResult>;
}

export const SERVER_SPEAKER = 'Speaker 1';
