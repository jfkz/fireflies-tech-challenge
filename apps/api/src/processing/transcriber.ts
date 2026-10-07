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
  /** The model told the speakers apart itself; otherwise every segment is "Speaker 1" and the Diarizer listens again. */
  diarized?: boolean;
}

/**
 * Server-side ASR for meetings that arrive without a transcript (browser recordings and uploads).
 * A model that diarizes (MAI-Transcribe) labels the speakers itself; with one that doesn't
 * (Whisper) every segment is "Speaker 1" until the Diarizer has listened.
 */
export abstract class Transcriber {
  abstract transcribe(input: TranscribeInput): Promise<TranscribeResult>;
}

export const SERVER_SPEAKER = 'Speaker 1';
