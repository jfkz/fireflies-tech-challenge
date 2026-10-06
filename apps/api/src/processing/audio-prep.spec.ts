import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { partWindows, prepareForTranscription } from './audio-prep';

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

describe('partWindows', () => {
  it('cuts back to back parts, each but the first starting a little early to overlap', () => {
    expect(partWindows(50, 20, 5)).toEqual([
      { start: 0, length: 20 },
      { start: 15, length: 25 },
      { start: 35, length: 15 },
    ]);
  });
  it('folds a last sliver shorter than the overlap into the part before', () => {
    expect(partWindows(42, 20, 5)).toEqual([
      { start: 0, length: 20 },
      { start: 15, length: 27 },
    ]);
    expect(partWindows(12, 20, 5)).toEqual([{ start: 0, length: 12 }]);
  });
});

// Real ffmpeg runs: slow on a busy CI runner.
vi.setConfig({ testTimeout: 30_000 });

describe('prepareForTranscription', () => {
  it('passes small files it can’t read through untouched', async () => {
    const audio = new Uint8Array([1, 2, 3]);
    expect(await prepareForTranscription(audio, 'audio/webm')).toEqual([{ audio, mediaType: 'audio/webm', offsetMs: 0 }]);
  });

  it('refuses a big file it can’t read', async () => {
    await expect(prepareForTranscription(new Uint8Array(2048), 'audio/webm', { maxBytes: 1024 })).rejects.toThrow('can’t be read');
  });

  it.skipIf(!hasFfmpeg)('keeps a short small recording as it is', async () => {
    const wav = toneWav(2);
    expect(await prepareForTranscription(wav, 'audio/wav')).toEqual([{ audio: wav, mediaType: 'audio/wav', offsetMs: 0 }]);
  });

  it.skipIf(!hasFfmpeg)('re-encodes a big but short recording for speech', async () => {
    const parts = await prepareForTranscription(toneWav(30), 'audio/wav', { maxBytes: 1024 * 1024 });
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ mediaType: 'audio/mpeg', offsetMs: 0 });
    expect(parts[0].audio.byteLength).toBeLessThan(200 * 1024);
  });

  it.skipIf(!hasFfmpeg)('cuts a long recording into overlapping parts, whatever its size', async () => {
    const parts = await prepareForTranscription(toneWav(25), 'audio/wav', { partSeconds: 10, overlapSeconds: 2 });
    expect(parts.map((p) => p.offsetMs)).toEqual([0, 8000, 18000]);
    expect(parts.every((p) => p.mediaType === 'audio/mpeg')).toBe(true);
  });
});
