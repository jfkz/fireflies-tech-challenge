import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeAudioContext, installFakeAudio } from '@/test/fakeAudio';
import { blipSchedule, lineDuration, MAX_VOICES, mouthAt, SPEECH_CPS, voiceFor, VoiceEngine } from './voice';

afterEach(() => vi.unstubAllGlobals());

describe('blipSchedule', () => {
  const voice = voiceFor(3);

  it('blips once per letter, timed to the typing speed, resting on spaces and punctuation', () => {
    const blips = blipSchedule('Hi, yo', voice);
    expect(blips.map((b) => b.at * SPEECH_CPS)).toEqual([0, 1, 4, 5]);
    expect(blips.every((b) => b.freq > 0 && b.dur > 0)).toBe(true);
  });

  it('holds vowels longer and louder than consonants', () => {
    const [h, i] = blipSchedule('hi', voice);
    expect(i.dur).toBeGreaterThan(h.dur);
    expect(i.level).toBeGreaterThan(h.level);
  });

  it('rises at the end of a question and settles at the end of a statement', () => {
    const q = blipSchedule('sorry what?', voice);
    const s = blipSchedule('sorry what.', voice);
    expect(q.at(-1)!.freq).toBeGreaterThan(s.at(-1)!.freq);
    expect(q[0].freq).toBe(s[0].freq);
  });

  it('gives each head its own stable voice', () => {
    expect(voiceFor(3)).toBe(voiceFor(3));
    expect(voiceFor(3)).not.toEqual(voiceFor(4));
    expect(voiceFor(-2)).toBe(voiceFor(2));
  });

  it('knows how long a line takes', () => {
    expect(lineDuration('x'.repeat(SPEECH_CPS))).toBe(1);
  });
});

describe('mouthAt', () => {
  const blips = blipSchedule('ab c', voiceFor(1));
  const slot = 1 / SPEECH_CPS;

  it('opens on letters, closes on spaces and after the line', () => {
    expect(mouthAt(blips, 0.1 * slot)).toBe(1); // a
    expect(mouthAt(blips, 1.5 * slot)).toBeCloseTo(0.55); // b
    expect(mouthAt(blips, 2.5 * slot)).toBe(0); // space
    expect(mouthAt(blips, 3.5 * slot)).toBeGreaterThan(0); // c
    expect(mouthAt(blips, 10 * slot)).toBe(0);
    expect(mouthAt(blips, -1)).toBe(0);
  });
});

describe('VoiceEngine', () => {
  it('stays silent without Web Audio or before it is unlocked', () => {
    const engine = new VoiceEngine();
    expect(engine.unlock()).toBe(false);
    expect(engine.speak(blipSchedule('hello', voiceFor(1)), voiceFor(1))).toBeNull();
  });

  it('schedules one oscillator per blip once unlocked', async () => {
    installFakeAudio();
    const engine = new VoiceEngine();
    expect(engine.unlock()).toBe(true);
    await Promise.resolve();
    expect(engine.ready).toBe(true);
    const ctx = FakeAudioContext.instances[0];
    const blips = blipSchedule('hello there', voiceFor(2));
    const u = engine.speak(blips, voiceFor(2))!;
    expect(ctx.oscillators).toHaveLength(blips.length);
    expect(ctx.oscillators[0].start).toHaveBeenCalled();
    expect(u.end).toBeCloseTo(blips.at(-1)!.at + blips.at(-1)!.dur);
    expect(engine.speak([], voiceFor(2))).toBeNull();
    // Finished lines free their slot.
    ctx.oscillators.at(-1)!.onended?.();
  });

  it(`cuts off the oldest voice beyond ${MAX_VOICES} and hushes everyone`, async () => {
    installFakeAudio();
    const engine = new VoiceEngine();
    engine.unlock();
    await Promise.resolve();
    const v = voiceFor(1);
    const first = engine.speak(blipSchedule('one', v), v)!;
    const stopFirst = vi.spyOn(first, 'stop');
    engine.speak(blipSchedule('two', v), v);
    engine.speak(blipSchedule('three', v), v);
    expect(stopFirst).toHaveBeenCalled();
    const ctx = FakeAudioContext.instances[0];
    engine.hush();
    expect(ctx.oscillators.at(-1)!.stop).toHaveBeenCalledTimes(2);
  });
});
