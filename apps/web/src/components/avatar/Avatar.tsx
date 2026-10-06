import { useId, type ReactNode } from 'react';
import { faceFor, RESTING_POSE, type Pose } from '@/lib/avatar/pose';
import { INK, type AvatarStyle } from '@/lib/avatar/styles';

/** Rounds coordinates so the SVG stays small. */
const n = (v: number) => Math.round(v * 100) / 100;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const MOUTH = '#5c1a2e';
const TONGUE = '#ff7887';

export interface AvatarProps {
  style: AvatarStyle;
  pose?: Pose;
  /** -1 looks left, 1 looks right. */
  look?: number;
  /** -1 looks up, 1 looks down. */
  lookY?: number;
  className?: string;
  /** Accessible name. Without one the head is decorative. */
  label?: string;
  /** Position when nested inside another SVG. */
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

/**
 * A cartoon head drawn in a 200×200 design space — an SVG port of the Mac app's
 * `AvatarPainter`. Pure: everything it shows comes from `pose`.
 */
export function Avatar({ style, pose = RESTING_POSE, look = 0, lookY = 0, className, label, x, y, width, height }: AvatarProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const face = faceFor(pose);
  const headTransform = `translate(100 ${n(150 + pose.bob + face.headDrop)}) rotate(${n((pose.tilt * 180) / Math.PI)}) translate(-100 -150)`;
  const shoulderY = 160 + pose.bob * 0.3;
  const stroke = { stroke: INK, strokeWidth: 3.2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

  return (
    <svg
      viewBox="0 0 200 200"
      x={x}
      y={y}
      width={width}
      height={height}
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-mouth={pose.mouth > 0.06 ? 'open' : 'closed'}
      data-eyes={eyesState(pose)}
    >
      {style.hairCut === 'long' && (
        <g transform={headTransform}>
          <rect x={32} y={30} width={136} height={152} rx={56} fill={style.hair} {...stroke} />
        </g>
      )}
      <rect x={30} y={n(shoulderY)} width={140} height={90} rx={50} fill={style.shirt} {...stroke} />
      {style.badge !== 'none' && <BadgeGlyph kind={style.badge} x={100} y={n(186 + pose.bob * 0.3)} color={style.shirt} />}
      <rect x={86} y={128} width={28} height={40} rx={9} fill={style.skin} {...stroke} />
      <g transform={headTransform}>
        <Head style={style} pose={pose} look={look} lookY={lookY} uid={uid} />
      </g>
    </svg>
  );
}

export function eyesState(pose: Pose): 'joy' | 'shut' | 'open' {
  if (pose.joy > 0.5) return 'joy';
  return eyeOpenness(pose) < 0.2 ? 'shut' : 'open';
}

function eyeOpenness(pose: Pose): number {
  return Math.max(1 - pose.blink, 0) * clamp(1 - pose.sleep * 1.15, 0, 1) * (1 - 0.85 * pose.yawn);
}

function Head({ style, pose, look, lookY, uid }: { style: AvatarStyle; pose: Pose; look: number; lookY: number; uid: string }) {
  const stroke = { stroke: INK, strokeWidth: 3.2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
  const disgusted = pose.emotions.disgusted ?? 0;
  const faceClip = `${uid}-face`;
  return (
    <>
      <defs>
        <clipPath id={faceClip}>
          <ellipse cx={100} cy={95} rx={56} ry={61} />
        </clipPath>
      </defs>
      {style.hairCut === 'bob' && <circle cx={100} cy={92} r={66} fill={style.hair} {...stroke} />}
      {[46, 154].map((x) => (
        <ellipse key={x} cx={x} cy={102} rx={13} ry={14} fill={style.skin} {...stroke} />
      ))}
      <ellipse cx={100} cy={95} rx={56} ry={61} fill={style.skin} {...stroke} />
      {style.beard && (
        <>
          <path
            clipPath={`url(#${faceClip})`}
            d="M46 100Q50 160 100 162Q150 160 154 100Q136 118 100 118Q64 118 46 100Z"
            fill={style.hair}
          />
          <ellipse cx={100} cy={95} rx={56} ry={61} fill="none" {...stroke} />
        </>
      )}
      {disgusted > 0.05 && (
        <rect clipPath={`url(#${faceClip})`} x={40} y={104} width={120} height={56} fill="#73bf4d" opacity={n(0.3 * disgusted)} />
      )}
      <path d={FRINGES[style.hairCut]} fill={style.hair} {...stroke} />
      <Face style={style} pose={pose} look={look} lookY={lookY} uid={uid} />
      <GearShape style={style} />
      <EmotionMarks pose={pose} />
    </>
  );
}

const FRINGES: Record<AvatarStyle['hairCut'], string> = {
  bob: 'M45 96C38 50 66 28 100 28C134 28 162 50 155 96Q150 66 132 62Q118 72 104 66Q92 54 76 58Q52 64 45 96Z',
  long: 'M45 96C38 50 66 28 100 28C134 28 162 50 155 96Q150 66 132 62Q118 72 104 66Q92 54 76 58Q52 64 45 96Z',
  short: 'M46 90C38 46 64 26 100 26C136 26 162 46 154 90Q152 62 140 58Q100 46 64 56Q50 62 46 90Z',
  spiky:
    'M46 86L40 62L56 60L52 40L72 44L76 22L94 36L108 16L116 38L136 28L136 48L156 48L154 86Q146 60 120 58Q100 68 78 60Q54 60 46 86Z',
};

function Face({ style, pose, look, lookY, uid }: { style: AvatarStyle; pose: Pose; look: number; lookY: number; uid: string }) {
  const face = faceFor(pose);
  const lookX = look * 3.5;
  const lookDown = lookY * 2.5;
  const open = eyeOpenness(pose);
  const upperLid = face.upperLid + pose.sleep * 0.6;
  const angry = pose.emotions.angry ?? 0;
  const happy = pose.emotions.happy ?? 0;
  const lineStroke = { stroke: INK, strokeWidth: 3.2, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' } as const;

  const eyes: ReactNode[] = [];
  for (const x of [78, 122]) {
    if (pose.joy > 0.5) {
      eyes.push(<path key={x} d={`M${x - 10} 99Q${x} 88 ${x + 10} 99`} {...lineStroke} />);
      continue;
    }
    if (open < 0.2) {
      eyes.push(<path key={x} d={`M${x - 10} 97Q${x} 102 ${x + 10} 97`} {...lineStroke} />);
      continue;
    }
    const height = 26 * open * face.eyeOpen;
    const top = 97 - height / 2;
    const size = face.pupil;
    const clip = `${uid}-eye${x}`;
    const inner = x < 100 ? x + 12 : x - 12;
    const outer = x < 100 ? x - 12 : x + 12;
    const innerY = top + height * Math.min(0.8, Math.max(0, upperLid + face.lidSlant * 0.35));
    const outerY = top + height * Math.min(0.8, Math.max(0, upperLid - face.lidSlant * 0.35));
    const bottom = top + height;
    const rise = height * face.lowerLid;
    const outerSide = x < 100 ? -1 : 1;
    eyes.push(
      <g key={x}>
        <defs>
          <clipPath id={clip}>
            <ellipse cx={x} cy={97} rx={11} ry={n(height / 2)} />
          </clipPath>
        </defs>
        <ellipse cx={x} cy={97} rx={11} ry={n(height / 2)} fill="#fff" />
        <g clipPath={`url(#${clip})`}>
          <ellipse cx={n(x + lookX)} cy={n(100 + lookDown)} rx={n(7.5 * size)} ry={n(8 * size)} fill={INK} />
          <circle cx={n(x + lookX + 1.5)} cy={n(103.5 - 7 * size + lookDown)} r={2.5} fill="#fff" />
          {Math.max(innerY, outerY) > top + 1 && (
            <>
              <path d={`M${outer} ${n(top - 2)}L${inner} ${n(top - 2)}L${inner} ${n(innerY)}L${outer} ${n(outerY)}Z`} fill={style.skin} />
              <path d={`M${outer} ${n(outerY)}L${inner} ${n(innerY)}`} stroke={INK} strokeWidth={2.5} strokeLinecap="round" />
            </>
          )}
          {face.lowerLid > 0.02 && (
            <>
              <path
                d={`M${x - 13} ${n(bottom + 2)}L${x - 13} ${n(bottom - rise * 0.4)}Q${x} ${n(bottom - rise * 1.6)} ${x + 13} ${n(bottom - rise * 0.4)}L${x + 13} ${n(bottom + 2)}Z`}
                fill={style.skin}
              />
              <path
                d={`M${x - 13} ${n(bottom - rise * 0.4)}Q${x} ${n(bottom - rise * 1.6)} ${x + 13} ${n(bottom - rise * 0.4)}`}
                stroke={INK}
                strokeWidth={2.5}
                strokeLinecap="round"
                fill="none"
              />
            </>
          )}
        </g>
        <ellipse cx={x} cy={97} rx={11} ry={n(height / 2)} fill="none" stroke={INK} strokeWidth={2.5} />
        {style.lashes && (
          <path
            d={[
              [9, -9],
              [12, -4],
            ]
              .map(([dx, dy]) => {
                const fx = x + outerSide * (dx - 2);
                const fy = top + (dy + 9) * 0.6;
                return `M${n(fx)} ${n(fy)}L${n(fx + outerSide * 5)} ${n(fy - 4)}`;
              })
              .join('')}
            stroke={INK}
            strokeWidth={2.4}
            strokeLinecap="round"
          />
        )}
      </g>,
    );
  }

  const flush = 0.35 + 0.25 * happy + 0.4 * angry;
  const grow = 1 + 0.4 * angry;
  const blush = `rgb(255 ${Math.round((0.45 - 0.15 * angry) * 255)} ${Math.round((0.5 - 0.2 * angry) * 255)})`;

  return (
    <>
      {[
        [78, -1],
        [122, 1],
      ].map(([x, side]) => (
        <rect
          key={x}
          x={-12}
          y={-3}
          width={24}
          height={6}
          rx={3}
          fill={INK}
          transform={`translate(${x} ${n(75 - pose.brow - face.browLift - side * face.browSkew)}) rotate(${n((side * face.browAngle * 180) / Math.PI)})`}
        />
      ))}
      {eyes}
      {!style.beard &&
        [66, 134].map((x) => (
          <ellipse key={x} cx={x} cy={n(112 + 5.5 * grow)} rx={n(10 * grow)} ry={n(5.5 * grow)} fill={blush} opacity={n(flush)} />
        ))}
      <path d="M96 111Q100 117 104 111" stroke={INK} strokeOpacity={0.7} strokeWidth={2.6} strokeLinecap="round" fill="none" />
      <Mouth pose={pose} uid={uid} />
    </>
  );
}

function Mouth({ pose, uid }: { pose: Pose; uid: string }) {
  const face = faceFor(pose);
  const m = pose.mouth;
  const line = { stroke: INK, strokeWidth: 3.2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
  const clip = `${uid}-mouth`;

  if (pose.yawn > 0.06) {
    // A huge yawn: a tall dark oval with the tongue at the bottom.
    const rx = 8 + 5 * pose.yawn;
    const ry = 4 + 13 * pose.yawn;
    return (
      <g data-part="yawn">
        <ellipse cx={100} cy={n(129 + ry * 0.4)} rx={n(rx)} ry={n(ry)} fill={MOUTH} stroke={INK} strokeWidth={2.8} />
        <ellipse cx={100} cy={n(129 + ry * 1.05)} rx={n(rx * 0.6)} ry={n(ry * 0.3)} fill={TONGUE} />
      </g>
    );
  }

  if (pose.sleep > 0.6 && m < 0.06) {
    // Asleep: a small round mouth that breathes.
    const r = 3.5 + 1.2 * Math.sin(pose.time * 1.8);
    return <ellipse cx={100} cy={131} rx={n(r)} ry={n(r * 1.15)} fill={MOUTH} stroke={INK} strokeWidth={2.4} data-part="snore" />;
  }

  if (m < 0.06) {
    // A big grin for joy, an "o" for surprise or fear, otherwise a curve from smile to frown.
    const happy = Math.max(pose.emotions.happy ?? 0, pose.joy);
    const grin = clamp((happy - 0.35) / 0.3, 0, 1);
    const oh = clamp(((pose.emotions.surprised ?? 0) + (pose.emotions.scared ?? 0) * 0.7 - 0.35) / 0.3, 0, 1);
    const half = 13 * face.mouthWidth;
    const y = 127 + Math.max(0, -face.smile) * 0.35;
    return (
      <g data-part="closed">
        <path
          d={`M${n(100 - half)} ${n(y - face.mouthSkew / 2)}Q100 ${n(y + face.smile)} ${n(100 + half)} ${n(y + face.mouthSkew / 2)}`}
          fill="none"
          opacity={n(1 - Math.max(grin, oh))}
          {...line}
        />
        {grin > 0 && (
          <g opacity={n(grin)}>
            <defs>
              <clipPath id={`${clip}-grin`}>
                <path d="M83 124L117 124Q100 152 83 124Z" />
              </clipPath>
            </defs>
            <path d="M83 124L117 124Q100 152 83 124Z" fill={MOUTH} />
            <g clipPath={`url(#${clip}-grin)`}>
              <rect x={80} y={124} width={40} height={5} fill="#fff" />
              <ellipse cx={100} cy={138} rx={10} ry={6} fill={TONGUE} />
            </g>
            <path d="M83 124L117 124Q100 152 83 124Z" fill="none" stroke={INK} strokeWidth={2.8} strokeLinejoin="round" />
          </g>
        )}
        {oh > 0 && (
          <g opacity={n(oh)}>
            <ellipse cx={100} cy={131.5} rx={8} ry={9.5} fill={MOUTH} stroke={INK} strokeWidth={2.8} />
          </g>
        )}
      </g>
    );
  }

  // Talking: a soft upper lip and a rounder lower one. Teeth show only when it opens wide.
  const width = (24 - 5 * m) * Math.max(0.75, face.mouthWidth);
  const height = 3 + 17 * m;
  const top = 125;
  const corner = top + height * 0.25 - clamp(face.smile * 0.2, -4, 4);
  const lx = 100 - width / 2;
  const rx = 100 + width / 2;
  const ly = corner - face.mouthSkew / 2;
  const ry = corner + face.mouthSkew / 2;
  const d = `M${n(lx)} ${n(ly)}Q100 ${n(top - height * 0.3)} ${n(rx)} ${n(ry)}C${n(rx - width * 0.1)} ${n(top + height * 1.12)} ${n(lx + width * 0.1)} ${n(top + height * 1.12)} ${n(lx)} ${n(ly)}Z`;
  const bottom = top + height * 0.65;
  return (
    <g data-part="talking">
      <defs>
        <clipPath id={clip}>
          <path d={d} />
        </clipPath>
      </defs>
      <path d={d} fill={MOUTH} />
      <g clipPath={`url(#${clip})`}>
        <ellipse cx={100} cy={n(bottom - height * 0.05)} rx={n(width * 0.3)} ry={n(height * 0.3)} fill={TONGUE} />
        {m > 0.35 && (
          <rect
            x={n(100 - width / 2)}
            y={n(top - height)}
            width={n(width)}
            height={n(height + Math.min(3.5, height * 0.2))}
            fill="#fff"
            opacity={n(Math.min(1, (m - 0.35) / 0.15))}
          />
        )}
      </g>
      <path d={d} fill="none" stroke={INK} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

function dropPath(px: number, py: number, s: number): string {
  return `M${n(px)} ${n(py - s * 1.6)}Q${n(px + s * 0.9)} ${n(py - s * 0.5)} ${n(px + s * 0.985)} ${n(py + s * 0.174)}A${s} ${s} 0 0 1 ${n(px - s * 0.985)} ${n(py + s * 0.174)}Q${n(px - s * 0.9)} ${n(py - s * 0.5)} ${n(px)} ${n(py - s * 1.6)}Z`;
}

/** Cartoon marks for strong feelings, plus the Zzz of a sleeping head. */
function EmotionMarks({ pose }: { pose: Pose }) {
  const sad = pose.emotions.sad ?? 0;
  const angry = pose.emotions.angry ?? 0;
  const scared = pose.emotions.scared ?? 0;
  const marks: ReactNode[] = [];
  if (sad > 0.35) {
    const p = (pose.time * 0.6) % 1;
    marks.push(
      <path
        key="tear"
        d={dropPath(69, 110 + p * 26, 7)}
        fill="#73bfff"
        stroke={INK}
        strokeWidth={2}
        opacity={n(Math.min(1, (sad - 0.35) / 0.3) * (1 - p * p))}
      />,
    );
  }
  if (angry > 0.35) {
    const pulse = 1 + 0.12 * Math.sin(pose.time * 9);
    marks.push(
      <g key="vein" transform={`translate(140 52) scale(${n(pulse)})`} opacity={n(Math.min(1, (angry - 0.35) / 0.3))}>
        {[0, 90, 180, 270].map((deg) => (
          <g key={deg} transform={`rotate(${deg})`}>
            <path d="M3 -10Q3 -3 10 -3" stroke="#fff" strokeWidth={6.5} strokeLinecap="round" fill="none" />
            <path d="M3 -10Q3 -3 10 -3" stroke="#e62633" strokeWidth={3.5} strokeLinecap="round" fill="none" />
          </g>
        ))}
      </g>,
    );
  }
  if (scared > 0.35) {
    const slide = ((pose.time * 0.4) % 1) * 6;
    marks.push(
      <path key="sweat" d={dropPath(150, 62 + slide, 9)} fill="#b3e0ff" stroke={INK} strokeWidth={2} opacity={n(Math.min(1, (scared - 0.35) / 0.3))} />,
    );
  }
  if (pose.sleep > 0.6) {
    const fade = (pose.sleep - 0.6) / 0.4;
    for (let i = 0; i < 3; i++) {
      const p = (pose.time * 0.35 + i / 3) % 1;
      marks.push(
        <text
          key={`z${i}`}
          x={n(146 + p * 34 + Math.sin(p * 6 + i) * 4)}
          y={n(66 - p * 56)}
          fontSize={n(20 + p * 16)}
          fontWeight={900}
          style={{ fontFamily: 'var(--font-nunito), system-ui, sans-serif' }}
          fill="#fff"
          stroke={INK}
          strokeWidth={2.2}
          paintOrder="stroke"
          opacity={n(Math.sin(p * Math.PI) * fade)}
          data-part="zzz"
        >
          z
        </text>,
      );
    }
  }
  return <>{marks}</>;
}

function GearShape({ style }: { style: AvatarStyle }) {
  const gear = INK;
  const stroke = { stroke: INK, strokeWidth: 3.2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
  if (style.gear === 'headphones') {
    const band = 'M38.18 79.44A64 64 0 0 1 161.82 79.44';
    return (
      <g>
        <path d={band} stroke={gear} strokeOpacity={0.92} strokeWidth={9} strokeLinecap="round" fill="none" />
        <path d={band} stroke={style.accent} strokeWidth={3} strokeLinecap="round" fill="none" />
        {[40, 160].map((x) => (
          <rect key={x} x={x - 11} y={80} width={22} height={40} rx={10} fill={style.accent} {...stroke} />
        ))}
      </g>
    );
  }
  if (style.gear === 'headset') {
    return (
      <g>
        <ellipse cx={155} cy={102} rx={10} ry={11} fill={style.accent} {...stroke} />
        <path d="M152 112Q150 140 126 138" stroke={gear} strokeOpacity={0.92} strokeWidth={4} strokeLinecap="round" fill="none" />
        <rect x={114} y={132} width={15} height={11} rx={5.5} fill={style.accent} {...stroke} strokeWidth={2.2} />
      </g>
    );
  }
  return null;
}

/** The channel badge on the shirt: a microphone for "You", a speaker for everyone else. */
function BadgeGlyph({ kind, x, y, color }: { kind: 'mic' | 'speaker'; x: number; y: number; color: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={15} fill="#fff" fillOpacity={0.9} />
      {kind === 'mic' ? (
        <g fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round">
          <rect x={-3.5} y={-9} width={7} height={11} rx={3.5} fill={color} stroke="none" />
          <path d="M-6.5 -1.5Q-6.5 6 0 6Q6.5 6 6.5 -1.5M0 6V9.5" />
        </g>
      ) : (
        <g>
          <path d="M-9 -3.5H-5L1 -8.5V8.5L-5 3.5H-9Z" fill={color} />
          <path d="M4 -4Q7 0 4 4M7 -7Q12 0 7 7" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
        </g>
      )}
    </g>
  );
}
