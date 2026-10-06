import { Injectable } from '@nestjs/common';
import { transcribe } from 'ai';
import { AppConfig } from '../config/config.module';
import { prepareForTranscription } from './audio-prep';
import { SERVER_SPEAKER, Transcriber, type TranscribeInput, type TranscribeResult } from './transcriber';

/** Whisper through the Vercel AI Gateway (`openai/whisper-1` by default), same key as the summarizer. */
@Injectable()
export class GatewayTranscriber extends Transcriber {
  constructor(private readonly config: AppConfig) {
    super();
  }

  /**
   * Big or long recordings are compressed and cut into overlapping parts first (the API takes at
   * most 25 MB a request). Parts go in order, each told how the previous one ended so names and
   * spelling carry over the cut, and their transcripts are stitched into one.
   */
  async transcribe({ audio, mediaType, language }: TranscribeInput): Promise<TranscribeResult> {
    const parts = await prepareForTranscription(audio, mediaType);
    const results: TranscribeResult[] = [];
    let detected = language;
    for (const part of parts) {
      const context = results.length ? tailText(results[results.length - 1]) : '';
      const result = await transcribe({
        model: this.config.env.TRANSCRIBE_MODEL,
        audio: part.audio,
        providerOptions: {
          openai: { timestampGranularities: ['segment'], ...(detected ? { language: detected } : {}), ...(context ? { prompt: context } : {}) },
        },
      });
      const piece = shiftResult(toTranscribeResult(result), part.offsetMs);
      // Later parts are held to the language the first one heard.
      detected ??= piece.language;
      results.push(piece);
    }
    return joinResults(results);
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

/** Moves a part's segments to where the part starts in the whole recording. */
export function shiftResult(r: TranscribeResult, offsetMs: number): TranscribeResult {
  if (offsetMs === 0) return r;
  return {
    ...r,
    segments: r.segments.map((s) => ({ ...s, startMs: s.startMs + offsetMs, endMs: s.endMs + offsetMs })),
    // A part's length becomes where it ends in the whole recording.
    durationSec: r.durationSec !== null ? Math.round(r.durationSec + offsetMs / 1000) : null,
  };
}

/** About the last 200 characters a part ended with: the "prompt" that tells the next part what came before. */
export function tailText(r: TranscribeResult, max = 200): string {
  const text = r.segments.map((s) => s.text).join(' ').trim();
  if (text.length <= max) return text;
  const cut = text.slice(-max);
  return cut.slice(cut.indexOf(' ') + 1);
}

/**
 * One transcript from overlapping parts (already shifted to their place in the recording).
 * Where two parts overlap, a segment is kept from the later part only if most of it comes after
 * what the earlier parts already covered, so the seam has no repeated lines.
 */
export function joinResults(results: readonly TranscribeResult[]): TranscribeResult {
  if (results.length === 1) return results[0];
  const segments: TranscribeResult['segments'] = [];
  let coveredUntil = 0;
  for (const r of results) {
    for (const s of r.segments) {
      if (segments.length > 0 && (s.startMs + s.endMs) / 2 < coveredUntil) continue;
      segments.push(s);
      coveredUntil = Math.max(coveredUntil, s.endMs);
    }
  }
  return {
    segments,
    language: results.find((r) => r.language)?.language ?? null,
    durationSec: results[results.length - 1].durationSec,
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
