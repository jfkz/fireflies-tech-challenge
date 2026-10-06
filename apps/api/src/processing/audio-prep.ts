import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Whisper (through the AI Gateway) refuses requests over 25 MiB; stay clear of it. */
export const WHISPER_MAX_BYTES = 24 * 1024 * 1024;
/** Parts of a long recording, each well under the limit at the speech bitrate below. */
export const PART_SECONDS = 60 * 60;

export interface AudioPart {
  audio: Uint8Array;
  mediaType: string;
  /** Where this part starts in the original recording. */
  offsetMs: number;
}

/**
 * Makes audio fit the transcription API. Small files pass through untouched. Bigger ones are
 * re-encoded for speech (mono, 16 kHz, 24 kbps MP3: ~11 MB an hour, all Whisper uses anyway),
 * and anything still too big is cut into hour-long parts.
 */
export async function prepareForTranscription(
  audio: Uint8Array,
  mediaType: string,
  opts: { maxBytes?: number; partSeconds?: number } = {},
): Promise<AudioPart[]> {
  const maxBytes = opts.maxBytes ?? WHISPER_MAX_BYTES;
  const partSeconds = opts.partSeconds ?? PART_SECONDS;
  if (audio.byteLength <= maxBytes) return [{ audio, mediaType, offsetMs: 0 }];

  const dir = await mkdtemp(join(tmpdir(), 'bt-audio-'));
  try {
    const input = join(dir, 'input');
    await writeFile(input, audio);
    const speech = ['-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '24k'];
    const whole = join(dir, 'speech.mp3');
    await ffmpeg(['-i', input, ...speech, whole]);
    const compressed = await readFile(whole);
    if (compressed.byteLength <= maxBytes) return [{ audio: compressed, mediaType: 'audio/mpeg', offsetMs: 0 }];

    // Cut the compressed file without re-encoding; each part restarts its timestamps at zero.
    await ffmpeg(['-i', whole, '-f', 'segment', '-segment_time', String(partSeconds), '-c', 'copy', '-reset_timestamps', '1', join(dir, 'part-%03d.mp3')]);
    const names = (await readdir(dir)).filter((n) => n.startsWith('part-')).sort();
    const parts: AudioPart[] = [];
    let offsetMs = 0;
    for (const name of names) {
      const file = join(dir, name);
      parts.push({ audio: await readFile(file), mediaType: 'audio/mpeg', offsetMs });
      offsetMs += Math.round((await durationSeconds(file)) * 1000);
    }
    return parts;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function ffmpeg(args: string[]): Promise<void> {
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { maxBuffer: 16 * 1024 * 1024 });
}

async function durationSeconds(file: string): Promise<number> {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  const seconds = Number(stdout.trim());
  return Number.isFinite(seconds) ? seconds : 0;
}
