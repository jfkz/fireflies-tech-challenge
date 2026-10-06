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
    .filter((s) => s.text.length > 0 && !isSilenceHallucination(s.text));
  // A transcript of nothing but "Thank you." is Whisper hearing silence, not a meeting.
  if (segments.length > 0 && segments.every((s) => isFillerOnly(s.text))) segments.length = 0;
  // Some models return only text; keep it as one segment rather than losing it.
  if (result.segments.length === 0 && result.text.trim() && !isNoSpeechText(result.text)) {
    segments.push({ speaker: SERVER_SPEAKER, startMs: 0, endMs: Math.round((result.durationInSeconds ?? 0) * 1000), text: result.text.trim() });
  }
  return {
    segments,
    language: result.language ?? null,
    durationSec: result.durationInSeconds != null ? Math.round(result.durationInSeconds) : null,
  };
}

const normalize = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * What Whisper writes when it is given silence or noise: sign-offs and subtitle
 * credits from the videos it was trained on. They never occur in a real meeting,
 * so a segment that is one of these is dropped.
 */
const SILENCE_HALLUCINATIONS = [
  /^(thank you|thanks) (so much )?for watching( and see you next time)?$/,
  /(please )?(like and )?subscribe( to (my|our|the) channel)?$/,
  /^(subtitles|captions|transcription) (by|from) /,
  /amara org/,
  /^дякую за перегляд$/,
  /^(спасибо|благодарю) за (просмотр|внимание)$/,
  /^субтитры (сделал|создавал|подготовил)/,
  /^редактор субтитров/,
  /^продолжение следует$/,
  /^подписывайтесь на (канал|наш канал)$/,
  /^untertitel (der|von|im auftrag)/,
  /^vielen dank f[uü]rs zuschauen$/,
  /^sous titr(age|es) /,
  /^merci d avoir regard[ée]/,
  /^gracias por ver( el video)?$/,
  /^obrigad[oa] por assistir$/,
  /^grazie per la visione$/,
  /^ご視聴ありがとうございました$/,
];

export function isSilenceHallucination(text: string): boolean {
  const t = normalize(text);
  return t.length > 0 && SILENCE_HALLUCINATIONS.some((re) => re.test(t));
}

/** Short fillers that are only suspicious when they are all there is. */
const FILLERS = new Set(['thank you', 'thanks', 'you', 'bye', 'okay', 'ok', 'спасибо', 'дякую', 'danke', 'merci', 'gracias']);

export function isFillerOnly(text: string): boolean {
  return FILLERS.has(normalize(text));
}

/** Text made only of silence hallucinations and fillers, sentence by sentence. */
export function isNoSpeechText(text: string): boolean {
  const parts = text.split(/[.!?…\n]+/).map((p) => p.trim()).filter(Boolean);
  return parts.length > 0 && parts.every((p) => isSilenceHallucination(p) || isFillerOnly(p));
}
