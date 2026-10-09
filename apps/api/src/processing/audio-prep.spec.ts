import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { partWindows, prepareForTranscription, splitChannels } from './audio-prep';

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
    expect(await prepareForTranscription(wav, 'audio/wav')).toEqual([{ audio: wav, mediaType: 'audio/wav', offsetMs: 0, durationMs: 2000 }]);
  });

  it.skipIf(!hasFfmpeg)('re-encodes even a small recording when asked (APIs that only take MP3)', async () => {
    const parts = await prepareForTranscription(toneWav(2), 'audio/wav', { encode: true });
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ mediaType: 'audio/mpeg', offsetMs: 0, durationMs: 2000 });
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

/** A stereo WAV with a tone on the left channel only (the microphone) and silence on the right. */
function leftOnlyWav(seconds: number, layout = 'pan=stereo|c0=c0|c1=0*c0'): Uint8Array {
  const dir = mkdtempSync(join(tmpdir(), 'bt-left-'));
  try {
    const file = join(dir, 'left.wav');
    execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`, '-af', layout, '-ar', '16000', file]);
    return new Uint8Array(readFileSync(file));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Channels and loudest sample (dB) of an audio file, by ffprobe and ffmpeg's volumedetect. */
function inspect(audio: Uint8Array): { channels: number; maxDb: number } {
  const dir = mkdtempSync(join(tmpdir(), 'bt-inspect-'));
  try {
    const file = join(dir, 'audio');
    writeFileSync(file, audio);
    const channels = Number(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=channels', '-of', 'csv=p=0', file]).toString().trim());
    const log = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-']).stderr.toString();
    const max = /max_volume: (-?[\d.]+|-inf) dB/.exec(log)?.[1] ?? '-inf';
    return { channels, maxDb: max === '-inf' ? -Infinity : Number(max) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('splitChannels', () => {
  it.skipIf(!hasFfmpeg)('gives each side on its own and a mono mix to play', async () => {
    const { mic, system, mix } = await splitChannels(leftOnlyWav(2));
    const sides = { mic: inspect(mic), system: inspect(system), mix: inspect(mix) };
    expect(sides.mic.channels).toBe(1);
    expect(sides.mic.maxDb).toBeGreaterThan(-30);
    expect(sides.system.maxDb).toBeLessThan(-60);
    expect(sides.mix).toMatchObject({ channels: 1 });
    expect(sides.mix.maxDb).toBeGreaterThan(-30);
  });

  it.skipIf(!hasFfmpeg)('hears a mono file on both sides', async () => {
    const { mic, system } = await splitChannels(leftOnlyWav(1, 'pan=mono|c0=c0'));
    expect(inspect(mic).maxDb).toBeGreaterThan(-30);
    expect(inspect(system).maxDb).toBeGreaterThan(-30);
  });
});
