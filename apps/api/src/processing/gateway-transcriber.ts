import { Injectable } from '@nestjs/common';
import { transcribe } from 'ai';
import { AppConfig } from '../config/config.module';
import { prepareForTranscription } from './audio-prep';
import { SERVER_SPEAKER, Transcriber, type TranscribeInput, type TranscribeResult } from './transcriber';

/** Transcription models that tell the speakers apart themselves (a speaker per phrase). */
export function diarizesItself(model: string): boolean {
  return model.startsWith('microsoft/mai-transcribe');
}

/**
 * A diarizing model hears up to this much in one request, so one meeting keeps one set of speaker
 * numbers (an hour of 24 kbps speech is ~11 MB; the gateway took it in ~17 s).
 */
export const DIARIZED_PART_SECONDS = 60 * 60;
/** Parts of longer meetings share this much audio, enough to match the speakers across the cut. */
export const DIARIZED_OVERLAP_SECONDS = 90;

/**
 * Speech to text through the Vercel AI Gateway, same key as the summarizer. MAI-Transcribe 2
 * (the default) also says who speaks each phrase; Whisper-style models give one voice.
 */
@Injectable()
export class GatewayTranscriber extends Transcriber {
  constructor(private readonly config: AppConfig) {
    super();
  }

  async transcribe(input: TranscribeInput): Promise<TranscribeResult> {
    return diarizesItself(this.config.env.TRANSCRIBE_MODEL) ? this.transcribeDiarized(input) : this.transcribeWhisper(input);
  }

  /**
   * MP3 parts of up to an hour (Azure refuses some containers, such as AAC in M4A), each
   * transcribed with diarization; the parts' speakers are matched where they overlap.
   */
  private async transcribeDiarized({ audio, mediaType }: TranscribeInput): Promise<TranscribeResult> {
    const parts = await prepareForTranscription(audio, mediaType, {
      encode: true,
      partSeconds: DIARIZED_PART_SECONDS,
      overlapSeconds: DIARIZED_OVERLAP_SECONDS,
    });
    const results: TranscribeResult[] = [];
    for (const [index, part] of parts.entries()) {
      const result = await transcribe({
        model: this.config.env.TRANSCRIBE_MODEL,
        audio: part.audio,
        providerOptions: { azure: { diarization: { enabled: true } } },
      });
      results.push(shiftResult(fromPhrases(result, `${index}`, part.durationMs), part.offsetMs));
    }
    return joinDiarized(results);
  }

  /**
   * Big or long recordings are compressed and cut into overlapping parts first (the API takes at
   * most 25 MB a request). Parts go in order, each told how the previous one ended so names and
   * spelling carry over the cut, and their transcripts are stitched into one.
   */
  private async transcribeWhisper({ audio, mediaType, language }: TranscribeInput): Promise<TranscribeResult> {
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

interface Phrase {
  text: string;
  offsetMilliseconds: number;
  durationMilliseconds: number;
  locale?: string;
  speaker?: number;
}

function phrasesOf(providerMetadata: unknown): Phrase[] | null {
  const phrases = (providerMetadata as { azure?: { phrases?: unknown } } | undefined)?.azure?.phrases;
  if (!Array.isArray(phrases)) return null;
  return phrases.filter(
    (p): p is Phrase => typeof p?.text === 'string' && typeof p.offsetMilliseconds === 'number' && typeof p.durationMilliseconds === 'number',
  );
}

/**
 * One part from a diarizing model: a segment per phrase (a phrase ends where its speaker stops),
 * labelled `<part>:<speaker>` until `joinDiarized` names them. Without speaker numbers (diarization
 * off or unsupported) it falls back to the plain segments.
 */
export function fromPhrases(
  result: { text: string; segments: Array<{ text: string; startSecond: number; endSecond: number }>; language: string | undefined; durationInSeconds: number | undefined; providerMetadata?: unknown },
  part: string,
  partDurationMs?: number,
): TranscribeResult {
  const phrases = phrasesOf(result.providerMetadata);
  if (!phrases || phrases.length === 0 || phrases.some((p) => typeof p.speaker !== 'number')) {
    return { ...toTranscribeResult(result), diarized: false };
  }
  const segments = phrases
    .map((p) => ({
      speaker: `${part}:${p.speaker}`,
      startMs: Math.round(p.offsetMilliseconds),
      endMs: Math.round(p.offsetMilliseconds + Math.max(0, p.durationMilliseconds)),
      text: p.text.trim(),
    }))
    .filter((s) => s.text.length > 0 && !isSilenceHallucination(s.text));
  const durationSec = result.durationInSeconds ?? (partDurationMs !== undefined ? partDurationMs / 1000 : null);
  return {
    segments: segments.length > 0 && segments.every((s) => isFillerOnly(s.text)) ? [] : segments,
    language: result.language ?? mainLanguage(phrases),
    durationSec: durationSec !== null ? Math.round(durationSec) : null,
    diarized: true,
  };
}

/** The language spoken longest ("en-US" → "en"); a stray "Okay." heard as German doesn't count. */
export function mainLanguage(phrases: readonly Pick<Phrase, 'locale' | 'durationMilliseconds'>[]): string | null {
  const spoken = new Map<string, number>();
  for (const p of phrases) {
    const code = p.locale?.split('-')[0]?.toLowerCase();
    if (code) spoken.set(code, (spoken.get(code) ?? 0) + p.durationMilliseconds);
  }
  return [...spoken].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/**
 * Diarized parts (shifted into place) as one transcript. Each part numbers its own speakers, so
 * in the overlap every speaker of the later part is matched to the earlier speaker it overlaps
 * most; one who never speaks in the overlap becomes a new speaker. The overlap's lines are kept
 * once (as in `joinResults`), and the speakers are named "Speaker 1…N" by first appearance.
 */
export function joinDiarized(results: readonly TranscribeResult[]): TranscribeResult {
  const ids = new Map<string, string>();
  let next = 0;
  const merged: TranscribeResult['segments'] = [];
  let coveredUntil = 0;
  for (const r of results) {
    if (merged.length > 0) {
      const votes = new Map<string, Map<string, number>>();
      for (const s of r.segments) {
        if (s.startMs >= coveredUntil) continue;
        for (const m of merged) {
          const shared = Math.min(s.endMs, m.endMs) - Math.max(s.startMs, m.startMs);
          if (shared <= 0) continue;
          const tally = votes.get(s.speaker) ?? new Map<string, number>();
          tally.set(m.speaker, (tally.get(m.speaker) ?? 0) + shared);
          votes.set(s.speaker, tally);
        }
      }
      // Strongest matches first, and no two speakers of this part become the same person.
      const taken = new Set<string>();
      const pairs = [...votes].flatMap(([raw, tally]) => [...tally].map(([id, ms]) => ({ raw, id, ms }))).sort((a, b) => b.ms - a.ms);
      for (const { raw, id } of pairs) {
        if (ids.has(raw) || taken.has(id)) continue;
        ids.set(raw, id);
        taken.add(id);
      }
    }
    for (const s of r.segments) {
      if (!ids.has(s.speaker)) ids.set(s.speaker, `v${next++}`);
      if (merged.length > 0 && (s.startMs + s.endMs) / 2 < coveredUntil) continue;
      merged.push({ ...s, speaker: ids.get(s.speaker)! });
      coveredUntil = Math.max(coveredUntil, s.endMs);
    }
  }
  const names = new Map<string, string>();
  const segments = absorbStraySpeakers(merged).map((s) => {
    if (!names.has(s.speaker)) names.set(s.speaker, `Speaker ${names.size + 1}`);
    return { ...s, speaker: names.get(s.speaker)! };
  });
  const last = results[results.length - 1];
  return {
    segments,
    language: results.find((r) => r.language)?.language ?? null,
    durationSec: last?.durationSec ?? null,
    diarized: results.every((r) => r.diarized),
  };
}

/** A "speaker" heard this little is a diarization slip (one "Yeah." clustered on its own), not a person. */
const STRAY_MAX_MS = 2_000;
const STRAY_MAX_SEGMENTS = 2;

/** Gives a stray speaker's lines to whoever speaks nearest in time, when there are real speakers to give them to. */
export function absorbStraySpeakers<T extends { speaker: string; startMs: number; endMs: number }>(segments: readonly T[]): T[] {
  const totals = new Map<string, { ms: number; count: number }>();
  for (const s of segments) {
    const t = totals.get(s.speaker) ?? { ms: 0, count: 0 };
    totals.set(s.speaker, { ms: t.ms + (s.endMs - s.startMs), count: t.count + 1 });
  }
  const stray = new Set([...totals].filter(([, t]) => t.ms < STRAY_MAX_MS && t.count <= STRAY_MAX_SEGMENTS).map(([speaker]) => speaker));
  if (stray.size === 0 || stray.size === totals.size) return [...segments];
  return segments.map((s, i) => {
    if (!stray.has(s.speaker)) return s;
    let best: T | undefined;
    let gap = Infinity;
    for (let j = 0; j < segments.length; j++) {
      const o = segments[j];
      if (j === i || stray.has(o.speaker)) continue;
      const d = o.endMs <= s.startMs ? s.startMs - o.endMs : o.startMs >= s.endMs ? o.startMs - s.endMs : 0;
      if (d < gap) [best, gap] = [o, d];
    }
    return best ? { ...s, speaker: best.speaker } : s;
  });
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
