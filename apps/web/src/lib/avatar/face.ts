/** Port of the Mac app's `Emotion` / `FaceShape` (Emotion.swift). */
export type Emotion = 'neutral' | 'happy' | 'sad' | 'angry' | 'surprised' | 'scared' | 'disgusted';

export interface FaceShape {
  /** Brows move up by this (design units). */
  browLift: number;
  /** Radians the inner ends of the brows rise (negative: knitted, angry). */
  browAngle: number;
  /** One brow down, the other up (disgust). */
  browSkew: number;
  /** Eye height multiplier. */
  eyeOpen: number;
  /** Fraction of the eye covered by the upper lid. */
  upperLid: number;
  /** Upper lid lower at the inner corner (angry) or the outer one (sad, negative). */
  lidSlant: number;
  /** Fraction covered from below: cheeks pushed up by a smile. */
  lowerLid: number;
  pupil: number;
  /** Closed mouth: how far the middle dips below the corners (negative frowns). */
  smile: number;
  mouthWidth: number;
  /** Closed mouth: one corner up, the other down. */
  mouthSkew: number;
  /** Head lowered (positive) or pulled back up. */
  headDrop: number;
}

const NEUTRAL: FaceShape = {
  browLift: 0,
  browAngle: 0.14,
  browSkew: 0,
  eyeOpen: 1,
  upperLid: 0,
  lidSlant: 0,
  lowerLid: 0,
  pupil: 1,
  smile: 11,
  mouthWidth: 1,
  mouthSkew: 0,
  headDrop: 0,
};

const SHAPES: Record<Emotion, FaceShape> = {
  neutral: NEUTRAL,
  happy: { ...NEUTRAL, browLift: 3, browAngle: 0.1, eyeOpen: 0.95, lowerLid: 0.32, smile: 17, mouthWidth: 1.2, headDrop: -2 },
  sad: { ...NEUTRAL, browLift: 1, browAngle: 0.5, eyeOpen: 0.85, upperLid: 0.3, lidSlant: -0.6, pupil: 1.05, smile: -8, mouthWidth: 0.9, headDrop: 6 },
  angry: { ...NEUTRAL, browLift: -4, browAngle: -0.42, eyeOpen: 0.9, upperLid: 0.3, lidSlant: 0.7, pupil: 0.9, smile: -5, mouthWidth: 0.85 },
  surprised: { ...NEUTRAL, browLift: 10, browAngle: 0.08, eyeOpen: 1.3, pupil: 0.7, smile: 0, mouthWidth: 0.6, headDrop: -4 },
  scared: { ...NEUTRAL, browLift: 7, browAngle: 0.45, eyeOpen: 1.25, pupil: 0.6, smile: -4, mouthWidth: 0.95, headDrop: 2 },
  disgusted: { ...NEUTRAL, browLift: -1, browAngle: -0.12, browSkew: 5, eyeOpen: 0.85, upperLid: 0.25, lowerLid: 0.25, smile: -3, mouthWidth: 0.9, mouthSkew: 5 },
};

export function faceOf(emotion: Emotion): FaceShape {
  return SHAPES[emotion];
}

export type EmotionWeights = Partial<Record<Emotion, number>>;

const KEYS = Object.keys(NEUTRAL) as (keyof FaceShape)[];

/** The weighted mix of the emotions' faces; whatever the emotions leave is calm. */
export function blendFace(weights: EmotionWeights): FaceShape {
  const feelings = (Object.entries(weights) as [Emotion, number][]).filter(([e, w]) => e !== 'neutral' && w > 0);
  const feeling = feelings.reduce((sum, [, w]) => sum + w, 0);
  const total = Math.max(feeling, 1);
  const all: [Emotion, number][] = [...feelings, ['neutral', Math.max(0, 1 - feeling)]];
  const out = Object.fromEntries(KEYS.map((k) => [k, 0])) as unknown as FaceShape;
  for (const [emotion, weight] of all) {
    const shape = SHAPES[emotion];
    const w = weight / total;
    for (const k of KEYS) out[k] += shape[k] * w;
  }
  return out;
}

/** One emotion shown at `strength`, the rest calm. */
export function emotionWeights(emotion: Emotion, strength = 0.85): EmotionWeights {
  return emotion === 'neutral' ? { neutral: 1 } : { [emotion]: strength, neutral: 1 - strength };
}
