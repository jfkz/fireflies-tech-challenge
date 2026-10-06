'use client';

import { m, useTransform, type MotionValue } from 'motion/react';
import { INK } from '@/lib/avatar/styles';

const line = { stroke: INK, strokeWidth: 3, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

/** The "quick sync" wall clock. The minute hand follows `minutes` (5 → 58). */
export function WallClock({ minutes, className }: { minutes: MotionValue<number>; className?: string }) {
  const minuteAngle = useTransform(minutes, (v) => v * 6);
  const hourAngle = useTransform(minutes, (v) => 300 + v * 0.5);
  const label = useTransform(minutes, (v) => `${Math.round(v)} min`);
  return (
    <div className={className}>
      <svg viewBox="0 0 120 120" className="w-full" aria-hidden>
        <circle cx={60} cy={60} r={54} fill="#fff" {...line} strokeWidth={5} />
        {Array.from({ length: 12 }, (_, i) => (
          <line
            key={i}
            x1={60}
            y1={12}
            x2={60}
            y2={i % 3 === 0 ? 22 : 18}
            {...line}
            strokeWidth={i % 3 === 0 ? 4 : 2.5}
            transform={`rotate(${i * 30} 60 60)`}
          />
        ))}
        {/* The meeting so far, shaded on the dial. */}
        <m.line x1={60} y1={60} x2={60} y2={34} {...line} strokeWidth={6} style={{ rotate: hourAngle, originX: '60px', originY: '60px' }} />
        <m.line x1={60} y1={60} x2={60} y2={20} {...line} strokeWidth={4} stroke="#e0323f" style={{ rotate: minuteAngle, originX: '60px', originY: '60px' }} />
        <circle cx={60} cy={60} r={5} fill={INK} />
      </svg>
      <p className="mt-1 text-center text-[0.8rem] leading-tight font-extrabold text-white/90">
        Quick sync
        <br />
        <m.span className="tabular-nums">{label}</m.span>
      </p>
    </div>
  );
}

/** Whiteboard with a chart nobody can explain. */
export function Whiteboard({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 280 190" className={className} aria-hidden>
      <rect x={6} y={6} width={268} height={168} rx={14} fill="#fff" {...line} strokeWidth={4} />
      <rect x={110} y={174} width={60} height={12} rx={4} fill="#c9cdff" {...line} />
      <path d="M30 40L30 140L250 140" fill="none" {...line} />
      <path d="M36 70Q70 60 90 96T150 120Q180 128 200 76L214 112L240 50" fill="none" stroke="#5b67f5" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M232 52L240 50L242 60" fill="none" stroke="#5b67f5" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
      <text x={48} y={38} fontFamily="var(--font-display)" fontSize={22} fill={INK}>
        Q3 synergy?
      </text>
      <g transform="rotate(6 222 34)">
        <rect x={196} y={14} width={52} height={44} rx={4} fill="#ffd140" {...line} strokeWidth={2.5} />
        <path d="M204 30H240M204 40H230" {...line} strokeWidth={2.5} />
      </g>
      <g transform="rotate(-5 70 160)">
        <rect x={150} y={118} width={44} height={36} rx={4} fill="#ff8ca0" {...line} strokeWidth={2.5} />
        <path d="M158 132H186M158 142H176" {...line} strokeWidth={2.5} />
      </g>
    </svg>
  );
}

/** A window: the sky goes from noon to night as the meeting drags on. */
export function OfficeWindow({ sky, className }: { sky: MotionValue<string>; className?: string }) {
  return (
    <svg viewBox="0 0 200 220" className={className} aria-hidden>
      <m.rect x={8} y={8} width={184} height={190} rx={10} style={{ fill: sky }} />
      <circle cx={150} cy={52} r={18} fill="#fff" fillOpacity={0.85} />
      <path d="M30 120Q30 100 52 102Q60 84 82 92Q100 86 106 104Q124 106 120 122Z" fill="#fff" fillOpacity={0.9} />
      {/* Half-open blinds. */}
      {Array.from({ length: 6 }, (_, i) => (
        <rect key={i} x={8} y={8 + i * 11} width={184} height={8} fill="#eef0ff" stroke={INK} strokeWidth={2} />
      ))}
      <path d="M100 8V198M8 103H192" {...line} strokeWidth={4} />
      <rect x={8} y={8} width={184} height={190} rx={10} fill="none" {...line} strokeWidth={5} />
      <rect x={0} y={196} width={200} height={16} rx={6} fill="#c9cdff" {...line} />
    </svg>
  );
}

/** Office plant whose leaves droop as the meeting goes on (`droop` 0…1). */
export function Plant({ droop, className }: { droop: MotionValue<number>; className?: string }) {
  const leaves = [
    { r: -40, len: 70 },
    { r: -14, len: 86 },
    { r: 12, len: 80 },
    { r: 38, len: 66 },
  ];
  return (
    <svg viewBox="0 0 140 200" className={className} aria-hidden>
      {leaves.map((leaf, i) => (
        <Leaf key={i} base={leaf.r} len={leaf.len} droop={droop} />
      ))}
      <path d="M36 120H104L96 190H44Z" fill="#ff6a3d" {...line} strokeWidth={3.5} />
      <rect x={30} y={112} width={80} height={16} rx={6} fill="#ff8a5c" {...line} strokeWidth={3.5} />
    </svg>
  );
}

function Leaf({ base, len, droop }: { base: number; len: number; droop: MotionValue<number> }) {
  // Leaves on the left droop left, on the right droop right.
  const rotate = useTransform(droop, (d) => base + Math.sign(base || 1) * d * 70);
  return (
    <m.path
      d={`M70 118Q${70 - 18} ${118 - len * 0.6} 70 ${118 - len}Q${70 + 18} ${118 - len * 0.6} 70 118Z`}
      fill="#2db3a3"
      {...line}
      strokeWidth={3}
      style={{ rotate, originX: '70px', originY: '118px' }}
    />
  );
}

/** A coffee mug with steam, for the foreground parallax layer. */
export function Mug({ className, color = '#fff' }: { className?: string; color?: string }) {
  return (
    <svg viewBox="0 0 100 110" className={className} aria-hidden>
      <path d="M34 22Q26 12 34 4M50 22Q42 12 50 4M66 22Q58 12 66 4" fill="none" stroke="#fff" strokeWidth={4} strokeLinecap="round" opacity={0.8} />
      <path d="M72 46Q94 46 92 64Q90 80 70 80" fill="none" {...line} strokeWidth={7} />
      <path d="M72 46Q94 46 92 64Q90 80 70 80" fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" />
      <path d="M14 32H78L72 100Q71 106 64 106H28Q21 106 20 100Z" fill={color} {...line} strokeWidth={3.5} />
      <path d="M22 50H70" stroke="#ff6a3d" strokeWidth={8} />
      <path d="M14 32H78" {...line} strokeWidth={3.5} />
    </svg>
  );
}
