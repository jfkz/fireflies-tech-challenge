import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareForTranscription } from './audio-prep';

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

/** A WAV of `seconds` of tone: big (PCM) but tiny once encoded for speech. */
function toneWav(seconds: number): Uint8Array {
  const dir = mkdtempSync(join(tmpdir(), 'bt-tone-'));
  try {
    const file = join(dir, 'tone.wav');
    execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`, '-ac', '2', '-ar', '44100', file]);
    return new Uint8Array(readFileSync(file));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('prepareForTranscription', () => {
  it('passes small files through untouched', async () => {
    const audio = new Uint8Array([1, 2, 3]);
    expect(await prepareForTranscription(audio, 'audio/webm')).toEqual([{ audio, mediaType: 'audio/webm', offsetMs: 0 }]);
  });

  it.skipIf(!hasFfmpeg)('re-encodes a big file for speech so it fits', async () => {
    const wav = toneWav(30); // ~5 MB of PCM
    const parts = await prepareForTranscription(wav, 'audio/wav', { maxBytes: 1024 * 1024 });
    expect(parts).toHaveLength(1);
    expect(parts[0].mediaType).toBe('audio/mpeg');
    expect(parts[0].offsetMs).toBe(0);
    expect(parts[0].audio.byteLength).toBeLessThan(200 * 1024);
  });

  it.skipIf(!hasFfmpeg)('splits what is still too big into parts with their start times', async () => {
    const wav = toneWav(30);
    const parts = await prepareForTranscription(wav, 'audio/wav', { maxBytes: 50 * 1024, partSeconds: 10 });
    expect(parts.length).toBeGreaterThanOrEqual(3);
    expect(parts[0].offsetMs).toBe(0);
    // Cut on MP3 frame boundaries: each part starts about 10 s after the previous one.
    for (let i = 1; i < parts.length; i++) expect(Math.abs(parts[i].offsetMs - parts[i - 1].offsetMs - 10_000)).toBeLessThan(500);
    expect(parts.every((p) => p.mediaType === 'audio/mpeg')).toBe(true);
  });
});
