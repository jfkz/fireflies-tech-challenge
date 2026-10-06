import { Injectable } from '@nestjs/common';
import { transcribe } from 'ai';
import { AppConfig } from '../config/config.module';
import { SERVER_SPEAKER, Transcriber, type TranscribeInput, type TranscribeResult } from './transcriber';

/** Whisper through the Vercel AI Gateway (`openai/whisper-1` by default), same key as the summarizer. */
@Injectable()
export class GatewayTranscriber extends Transcriber {
  constructor(private readonly config: AppConfig) {
    super();
  }

  async transcribe({ audio, language }: TranscribeInput): Promise<TranscribeResult> {
    const result = await transcribe({
      model: this.config.env.TRANSCRIBE_MODEL,
      audio,
      providerOptions: {
        openai: { timestampGranularities: ['segment'], ...(language ? { language } : {}) },
      },
    });
    return toTranscribeResult(result);
  }
}

export function toTranscribeResult(result: {
  text: string;
  segments: Array<{ text: string; startSecond: number; endSecond: number }>;
  language: string | undefined;
  durationInSeconds: number | undefined;
}): TranscribeResult {
  const segments = result.segments
    .map((s) => ({
      speaker: SERVER_SPEAKER,
      startMs: Math.round(s.startSecond * 1000),
      endMs: Math.round(Math.max(s.endSecond, s.startSecond) * 1000),
      text: s.text.trim(),
    }))
    .filter((s) => s.text.length > 0);
  // Some models return only text; keep it as one segment rather than losing it.
  if (segments.length === 0 && result.text.trim()) {
    segments.push({ speaker: SERVER_SPEAKER, startMs: 0, endMs: Math.round((result.durationInSeconds ?? 0) * 1000), text: result.text.trim() });
  }
  return {
    segments,
    language: result.language ?? null,
    durationSec: result.durationInSeconds != null ? Math.round(result.durationInSeconds) : null,
  };
}
