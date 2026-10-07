import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Whisper (through the AI Gateway) refuses requests over 25 MiB; stay clear of it. */
export const WHISPER_MAX_BYTES = 24 * 1024 * 1024;
/**
 * Longer recordings are transcribed in parts of this length: each request stays quick (no
 * timeouts on a two-hour meeting) and far under the size limit.
 */
export const PART_SECONDS = 20 * 60;
/** Consecutive parts share this much audio, so a word cut at a boundary is heard whole once. */
export const OVERLAP_SECONDS = 5;

export interface AudioPart {
  audio: Uint8Array;
  mediaType: string;
  /** Where this part starts in the original recording. */
  offsetMs: number;
  /** How long it is, when known. */
  durationMs?: number;
}

export interface PrepareOptions {
  maxBytes?: number;
  partSeconds?: number;
  overlapSeconds?: number;
  /** Re-encode even a small file (for APIs that take MP3 but not every container). */
  encode?: boolean;
}

/**
 * Makes audio fit the transcription API. A short, small file passes through untouched. Anything
 * bigger is re-encoded for speech (mono, 16 kHz, 24 kbps MP3: ~11 MB an hour, all Whisper uses
 * anyway); anything longer than a part is cut into overlapping parts, which `stitchParts` joins.
 */
export async function prepareForTranscription(audio: Uint8Array, mediaType: string, opts: PrepareOptions = {}): Promise<AudioPart[]> {
  const maxBytes = opts.maxBytes ?? WHISPER_MAX_BYTES;
  const partSeconds = opts.partSeconds ?? PART_SECONDS;
  const overlapSeconds = opts.overlapSeconds ?? OVERLAP_SECONDS;

  const dir = await mkdtemp(join(tmpdir(), 'bt-audio-'));
  try {
    const input = join(dir, 'input');
    await writeFile(input, audio);
    const duration = await durationSeconds(input);
    // ffprobe can't read it (or reports nothing): send it as it is if it fits, and let the API judge.
    if (duration === null) {
      if (audio.byteLength <= maxBytes) return [{ audio, mediaType, offsetMs: 0 }];
      throw new Error('This recording can’t be read; try uploading it as MP3, M4A or WAV.');
    }
    const durationMs = Math.round(duration * 1000);
    if (!opts.encode && audio.byteLength <= maxBytes && duration <= partSeconds) return [{ audio, mediaType, offsetMs: 0, durationMs }];

    const speech = ['-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '24k'];
    if (duration <= partSeconds) {
      const out = join(dir, 'speech.mp3');
      await ffmpeg(['-i', input, ...speech, out]);
      return [{ audio: await readFile(out), mediaType: 'audio/mpeg', offsetMs: 0, durationMs }];
    }

    const parts: AudioPart[] = [];
    for (const { start, length } of partWindows(duration, partSeconds, overlapSeconds)) {
      const out = join(dir, `part-${parts.length}.mp3`);
      // -ss before -i seeks fast; re-encoding makes each part start cleanly on its own.
      await ffmpeg(['-ss', start.toFixed(3), '-t', length.toFixed(3), '-i', input, ...speech, out]);
      parts.push({ audio: await readFile(out), mediaType: 'audio/mpeg', offsetMs: Math.round(start * 1000), durationMs: Math.round(length * 1000) });
    }
    return parts;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Where each part starts and how long it is: back to back every `partSeconds`, each but the
 * first starting `overlapSeconds` early. A last sliver shorter than the overlap is folded into
 * the part before it.
 */
export function partWindows(duration: number, partSeconds: number, overlapSeconds: number): { start: number; length: number }[] {
  const windows: { start: number; length: number }[] = [];
  for (let at = 0; at < duration; at += partSeconds) {
    const start = Math.max(0, at - (at > 0 ? overlapSeconds : 0));
    const end = Math.min(duration, at + partSeconds);
    if (windows.length > 0 && duration - at <= overlapSeconds) {
      windows[windows.length - 1].length = duration - windows[windows.length - 1].start;
      break;
    }
    windows.push({ start, length: end - start });
  }
  return windows;
}

async function ffmpeg(args: string[]): Promise<void> {
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { maxBuffer: 16 * 1024 * 1024 });
}

/** Length in seconds, or null when ffprobe can't tell. */
export async function durationSeconds(file: string): Promise<number | null> {
  try {
    const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
    const seconds = Number(stdout.trim());
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  } catch {
    return null;
  }
}

/** At most this much audio goes to the diarization model in one request (it takes the audio inline). */
export const DIARIZE_MAX_BYTES = 18 * 1024 * 1024;

/**
 * The recording as compact speech for a model that listens (diarization): mono, 16 kHz, 24 kbps
 * MP3, cut into parts only when even that is too big to send at once. Null when ffmpeg can't read it.
 */
export async function speechParts(audio: Uint8Array, opts: { maxBytes?: number; partSeconds?: number } = {}): Promise<AudioPart[] | null> {
  const maxBytes = opts.maxBytes ?? DIARIZE_MAX_BYTES;
  const dir = await mkdtemp(join(tmpdir(), 'bt-speech-'));
  try {
    const input = join(dir, 'input');
    await writeFile(input, audio);
    const duration = await durationSeconds(input);
    if (duration === null) return null;
    const speech = ['-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '24k'];
    const whole = join(dir, 'speech.mp3');
    await ffmpeg(['-i', input, ...speech, whole]);
    const bytes = await readFile(whole);
    if (bytes.byteLength <= maxBytes) return [{ audio: bytes, mediaType: 'audio/mpeg', offsetMs: 0 }];
    const partSeconds = opts.partSeconds ?? Math.max(60, Math.floor((duration * maxBytes) / bytes.byteLength) - 30);
    const parts: AudioPart[] = [];
    for (let start = 0; start < duration; start += partSeconds) {
      const out = join(dir, `voices-${parts.length}.mp3`);
      await ffmpeg(['-ss', String(start), '-t', String(partSeconds), '-i', whole, '-c', 'copy', out]);
      parts.push({ audio: await readFile(out), mediaType: 'audio/mpeg', offsetMs: Math.round(start * 1000) });
    }
    return parts;
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
