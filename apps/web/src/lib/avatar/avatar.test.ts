import { describe, expect, it } from 'vitest';
import { blendFace, emotionWeights, faceOf } from './face';
import { blinkAmount, mulberry32, PoseAnimator, stillPose, syntheticSyllable } from './pose';
import { ALL_STYLES, styleForSpeaker, TALKER } from './styles';

describe('face blending', () => {
  it('is the neutral face with no feelings', () => {
    expect(blendFace({ neutral: 1 })).toEqual(faceOf('neutral'));
  });
  it('mixes an emotion with what is left of calm', () => {
    const half = blendFace({ happy: 0.5 });
    expect(half.smile).toBeCloseTo((17 + 11) / 2);
    expect(half.lowerLid).toBeCloseTo(0.16);
  });
  it('normalises when feelings add up past 1', () => {
    const f = blendFace({ angry: 1, sad: 1 });
    expect(f.browAngle).toBeCloseTo((-0.42 + 0.5) / 2);
  });
  it('builds weights for one emotion', () => {
    expect(emotionWeights('neutral')).toEqual({ neutral: 1 });
    expect(emotionWeights('sad', 0.6)).toEqual({ sad: 0.6, neutral: 0.4 });
  });
});

describe('pose', () => {
  it('blinks as a quick half-sine', () => {
    expect(blinkAmount(-1)).toBe(0);
    expect(blinkAmount(0.08)).toBeCloseTo(1);
    expect(blinkAmount(0.2)).toBe(0);
  });
  it('has a deterministic PRNG', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
  it('synthesises syllables between 0 and 1', () => {
    for (let t = 0; t < 10; t += 0.37) {
      const { syllable, level } = syntheticSyllable(t);
      expect(syllable).toBeGreaterThanOrEqual(0);
      expect(syllable).toBeLessThanOrEqual(1);
      expect(level).toBeLessThanOrEqual(1);
    }
  });
  it('still poses open the mouth only when asked', () => {
    expect(stillPose().mouth).toBe(0);
    expect(stillPose({ mouth: 0.4 })).toMatchObject({ mouth: 0.4, talk: 1, brow: 4 });
    expect(stillPose({ emotion: 'sad' }).emotions).toEqual({ sad: 0.85, neutral: 0.15 });
  });

  function simulate(input: Parameters<PoseAnimator['pose']>[1], seconds = 3, seed = 1) {
    const a = new PoseAnimator(seed);
    let p = a.pose(0, input);
    const poses = [p];
    for (let t = 1 / 30; t < seconds; t += 1 / 30) poses.push((p = a.pose(t, input)));
    return poses;
  }

  it('flaps the mouth while talking and keeps it shut otherwise', () => {
    expect(Math.max(...simulate({ talking: true }).map((p) => p.mouth))).toBeGreaterThan(0.2);
    expect(Math.max(...simulate({ talking: false }).map((p) => p.mouth))).toBe(0);
  });
  it('blinks every few seconds', () => {
    expect(simulate({ talking: false }, 8).some((p) => p.blink > 0.5)).toBe(true);
  });
  it('falls asleep, yawns and cheers smoothly', () => {
    expect(simulate({ talking: false, asleep: true }).at(-1)!.sleep).toBeGreaterThan(0.95);
    expect(simulate({ talking: false, yawning: true }).at(-1)!.yawn).toBeGreaterThan(0.95);
    expect(simulate({ talking: true, asleep: true }).every((p) => p.mouth === 0)).toBe(true);
    expect(simulate({ talking: false, cheering: true }).at(-1)!.joy).toBeGreaterThan(0.95);
  });
  it('glides into an emotion', () => {
    const poses = simulate({ talking: false, emotion: 'happy' }, 4);
    expect(poses[1].emotions.happy ?? 0).toBeLessThan(0.1);
    expect(poses.at(-1)!.emotions.happy).toBeGreaterThan(0.75);
  });
});

describe('styles', () => {
  it('ports all ten Talking Heads styles', () => {
    expect(ALL_STYLES).toHaveLength(10);
    for (const s of ALL_STYLES) expect(s.skin).toMatch(/^#[0-9a-f]{6}$/);
  });
  it('gives “You” the microphone head and everyone else a stable one', () => {
    expect(styleForSpeaker('You')).toBe(TALKER);
    expect(styleForSpeaker(' you ')).toBe(TALKER);
    expect(styleForSpeaker('Speaker 2')).toBe(styleForSpeaker('Speaker 2'));
    expect(styleForSpeaker('Speaker 2')).not.toBe(TALKER);
  });
});
