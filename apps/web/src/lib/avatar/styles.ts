/**
 * Head styles ported from the Mac app's `AvatarStyle` (AvatarView.swift).
 * Colours are the Swift RGB triples converted to hex.
 */
export type HairCut = 'bob' | 'long' | 'short' | 'spiky';
export type Gear = 'headphones' | 'headset' | 'none';
export type Badge = 'speaker' | 'mic' | 'none';

export interface AvatarStyle {
  name: string;
  skin: string;
  hair: string;
  shirt: string;
  accent: string;
  hairCut: HairCut;
  gear: Gear;
  badge: Badge;
  beard?: boolean;
  lashes?: boolean;
}

export const INK = '#292133';

function hex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

type Rgb = [number, number, number];

function voice(
  name: string,
  skin: Rgb,
  hair: Rgb,
  shirt: Rgb,
  accent: Rgb,
  hairCut: HairCut,
  extra: { beard?: boolean; lashes?: boolean } = {},
): AvatarStyle {
  return {
    name,
    skin: hex(...skin),
    hair: hex(...hair),
    shirt: hex(...shirt),
    accent: hex(...accent),
    hairCut,
    gear: 'headphones',
    badge: 'speaker',
    ...extra,
  };
}

/** Listens to what the Mac plays. */
export const LISTENER: AvatarStyle = {
  ...voice('teal', [0.98, 0.8, 0.67], [0.16, 0.7, 0.64], [0.36, 0.42, 1.0], [1.0, 0.82, 0.25], 'bob'),
};

/** Speaks into the microphone: "You". */
export const TALKER: AvatarStyle = {
  ...voice('talker', [0.91, 0.7, 0.54], [0.25, 0.17, 0.13], [1.0, 0.52, 0.24], [0.2, 0.22, 0.29], 'spiky'),
  gear: 'headset',
  badge: 'mic',
};

export const WOMEN: readonly AvatarStyle[] = [
  voice('auburn', [0.99, 0.84, 0.72], [0.66, 0.24, 0.14], [0.2, 0.66, 0.42], [1.0, 0.55, 0.62], 'long', { lashes: true }),
  voice('blonde', [0.97, 0.8, 0.68], [0.98, 0.8, 0.36], [0.93, 0.36, 0.58], [0.4, 0.75, 1.0], 'long', { lashes: true }),
  voice('violet', [0.8, 0.58, 0.44], [0.24, 0.14, 0.32], [1.0, 0.78, 0.22], [0.62, 0.42, 0.96], 'bob', { lashes: true }),
  voice('rose', [0.62, 0.42, 0.3], [0.12, 0.1, 0.12], [0.3, 0.78, 0.84], [1.0, 0.45, 0.35], 'long', { lashes: true }),
];

export const MEN: readonly AvatarStyle[] = [
  voice('brown', [0.93, 0.74, 0.58], [0.36, 0.23, 0.14], [0.24, 0.48, 0.92], [1.0, 0.7, 0.2], 'short'),
  voice('beard', [0.85, 0.62, 0.46], [0.14, 0.12, 0.14], [0.88, 0.28, 0.26], [0.3, 0.8, 0.7], 'short', { beard: true }),
  voice('ginger', [0.99, 0.83, 0.7], [0.86, 0.42, 0.16], [0.3, 0.66, 0.3], [0.36, 0.56, 1.0], 'spiky'),
  voice('grey', [0.7, 0.5, 0.38], [0.62, 0.62, 0.66], [0.5, 0.34, 0.8], [1.0, 0.8, 0.3], 'short', { beard: true }),
];

export const ALL_STYLES: readonly AvatarStyle[] = [TALKER, LISTENER, ...WOMEN, ...MEN];

/**
 * A stable head for a speaker label. "You" is always the microphone head; other
 * speakers get a head picked by hashing the label, so "Speaker 2" looks the same
 * on every page.
 */
export function styleForSpeaker(speaker: string): AvatarStyle {
  if (speaker.trim().toLowerCase() === 'you') return TALKER;
  const pool = [LISTENER, ...WOMEN, ...MEN];
  let h = 0;
  for (let i = 0; i < speaker.length; i++) h = (h * 31 + speaker.charCodeAt(i)) >>> 0;
  return pool[h % pool.length];
}
