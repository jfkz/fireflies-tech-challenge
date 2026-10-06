import { blendFace, type Emotion, type EmotionWeights, type FaceShape } from './face';

/** Everything the painter needs for one frame. All values are design units / radians / 0…1. */
export interface Pose {
  /** Seconds, for things that drift (Zzz, notes, tears). */
  time: number;
  talk: number;
  /** 0 closed … 1 wide open while talking. */
  mouth: number;
  /** 0 open … 1 shut (a blink in progress). */
  blink: number;
  /** Radians. */
  tilt: number;
  bob: number;
  brow: number;
  /** 0…1: eyes closed in a happy arc (cheering, bopping to music). */
  joy: number;
  /** 0…1: dozing off; at 1 the eyes are shut and Zzz float up. */
  sleep: number;
  /** 0…1: a big yawn. */
  yawn: number;
  emotions: EmotionWeights;
}

export const RESTING_POSE: Pose = {
  time: 0,
  talk: 0,
  mouth: 0,
  blink: 0,
  tilt: 0,
  bob: 0,
  brow: 0,
  joy: 0,
  sleep: 0,
  yawn: 0,
  emotions: { neutral: 1 },
};

/** A still pose, the way Talking Heads' MarketingArt draws its heads. */
export function stillPose(opts: Partial<Pose> & { emotion?: Emotion } = {}): Pose {
  const { emotion, ...rest } = opts;
  const mouth = rest.mouth ?? 0;
  return {
    ...RESTING_POSE,
    time: 0.6,
    talk: mouth > 0 ? 1 : 0,
    brow: mouth > 0 ? 4 : 0,
    emotions: emotion && emotion !== 'neutral' ? { [emotion]: 0.85, neutral: 0.15 } : { neutral: 1 },
    ...rest,
  };
}

export function faceFor(pose: Pose): FaceShape {
  return blendFace(pose.emotions);
}

/** What the head should be doing right now. */
export interface PoseInput {
  talking: boolean;
  emotion?: Emotion;
  /** 0…1 */
  emotionStrength?: number;
  asleep?: boolean;
  yawning?: boolean;
  cheering?: boolean;
  /**
   * Mouth opening from a voice that is actually playing (0…1). When set it
   * replaces the synthetic syllables, so the mouth follows the sound.
   */
  speech?: number;
}

/** Deterministic PRNG so tests (and SSR) can pin the blink schedule. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How shut the eye is `since` seconds after a blink started: a 0.16 s half-sine. */
export function blinkAmount(since: number): number {
  return since >= 0 && since < 0.16 ? Math.sin((since / 0.16) * Math.PI) : 0;
}

/**
 * The web has no microphone level to follow, so syllables are synthesised: a
 * flapping envelope with short gaps between "words".
 */
export function syntheticSyllable(t: number): { syllable: number; level: number } {
  const gate = Math.sin(t * 1.9) + Math.sin(t * 0.7) * 0.6 > -0.55 ? 1 : 0;
  const flap = Math.max(0, Math.sin(t * 11 + Math.sin(t * 2.3) * 1.6));
  return { syllable: gate * Math.pow(flap, 0.7), level: gate * (0.55 + 0.3 * Math.sin(t * 3.1)) };
}

/**
 * Smooths what a head is doing into a pose, frame by frame. Port of Talking
 * Heads' `AvatarAnimator`, minus the audio meter.
 */
export class PoseAnimator {
  private last: number | null = null;
  private talk = 0;
  private mouth = 0;
  private sleep = 0;
  private yawn = 0;
  private joy = 0;
  private lead: Record<string, number> = { neutral: 1 };
  private emotions: Record<string, number> = { neutral: 1 };
  private nextBlink = 0;
  private blinkStart = -10;
  private readonly phase: number;
  private readonly random: () => number;

  constructor(seed = 1) {
    this.random = mulberry32(seed);
    this.phase = this.random() * 100;
  }

  pose(t: number, input: PoseInput): Pose {
    const dt = Math.min(Math.max(t - (this.last ?? t), 0), 0.1);
    this.last = t;
    const tt = t + this.phase;
    const ease = (from: number, to: number, rate: number) => from + (to - from) * Math.min(1, dt * rate);

    const speaking = input.talking && !input.asleep;
    const voiced = input.speech !== undefined;
    const { syllable, level } = voiced ? { syllable: input.speech!, level: input.speech! > 0.05 ? 0.8 : 0 } : syntheticSyllable(tt);
    this.talk = ease(this.talk, speaking && level > 0.3 ? 1 : 0, 5);
    this.sleep = ease(this.sleep, input.asleep ? 1 : 0, 1.6);
    this.yawn = ease(this.yawn, input.yawning && !input.asleep ? 1 : 0, 4);
    this.joy = ease(this.joy, input.cheering ? 1 : 0, 5);

    // The face glides from one emotion to the next over about a second (two-stage
    // easing gives an S-curve, no jolt at the start).
    const strength = !input.emotion || input.emotion === 'neutral' ? 0 : (input.emotionStrength ?? 0.85);
    const rate = Math.min(1, dt * 2.6);
    const names = new Set([...Object.keys(this.lead), input.emotion ?? 'neutral', 'neutral']);
    for (const e of names) {
      const target = e === 'neutral' ? 1 - strength : e === input.emotion ? strength : 0;
      this.lead[e] = (this.lead[e] ?? 0) + (target - (this.lead[e] ?? 0)) * rate;
      this.emotions[e] = (this.emotions[e] ?? 0) + (this.lead[e] - (this.emotions[e] ?? 0)) * rate;
    }

    // Mouths open half way at most on ordinary syllables; a slow wobble keeps a run
    // of equal syllables from looking mechanical.
    const flap = 0.5 + 0.5 * Math.sin(tt * 14 + Math.sin(tt * 4.3) * 2.2);
    const target = !speaking ? 0 : voiced ? syllable * 0.55 : Math.pow(syllable, 1.2) * (0.3 + 0.1 * flap + 0.2 * level * level);
    this.mouth = ease(this.mouth, target, target > this.mouth ? 18 : 14);

    if (this.nextBlink === 0) this.nextBlink = t + 1 + this.random() * 2;
    if (t >= this.nextBlink) {
      this.blinkStart = t;
      // Now and then a quick double blink.
      this.nextBlink = t + (this.random() < 0.15 ? 0.3 : 2.5 + this.random() * 3);
    }

    const beat = t * 1.83 * Math.PI;
    const scared = this.emotions.scared ?? 0;
    const awake = 1 - this.sleep;
    return {
      time: t,
      talk: this.talk,
      mouth: this.mouth,
      blink: blinkAmount(t - this.blinkStart) * awake,
      tilt:
        awake *
          (this.talk * (Math.sin(tt * 3.1) * 0.07 + Math.sin(tt * 7.7) * 0.025) +
            Math.sin(tt * 0.7) * 0.03 +
            this.joy * Math.sin(beat / 2) * 0.11 +
            scared * Math.sin(tt * 47) * 0.014) +
        // Nodding off: the head lolls to one side and breathes slowly.
        this.sleep * (0.16 + Math.sin(tt * 0.9) * 0.025),
      bob:
        awake * (-this.talk * Math.abs(Math.sin(tt * 6.2)) * 5 + Math.sin(tt * 1.5) * 1.5 - this.joy * Math.abs(Math.sin(beat)) * 7) +
        this.sleep * (8 + Math.sin(tt * 0.9) * 2) +
        this.yawn * -3,
      brow: this.talk * (2 + 5 * level) + this.yawn * 5,
      joy: this.joy,
      sleep: this.sleep,
      yawn: this.yawn,
      emotions: { ...this.emotions },
    };
  }
}
