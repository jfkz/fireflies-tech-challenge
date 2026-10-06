import type { CSSProperties, ReactNode } from 'react';
import { INK } from '@/lib/avatar/styles';

export interface SpeechBubbleProps {
  children: ReactNode;
  /** Which bottom corner the tail sits at; it points down at the speaker. */
  side?: 'left' | 'right';
  tail?: boolean;
  className?: string;
  style?: CSSProperties;
  /** A coloured stripe telling whose bubble it is (the app's bubble-stack mode). */
  marker?: string;
}

// The Mac app's BubbleShape at scale 1: corner radius 22, tail 26×22.
const R = 22;
const TW = 26;
const TH = 22;

/**
 * The comic speech bubble: a rounded white body with an ink
 * outline and a curved tail at a bottom corner. Pure CSS + a small SVG for the
 * tail, so it renders on the server and wraps text naturally.
 */
export function SpeechBubble({ children, side = 'left', tail = true, className = '', style, marker }: SpeechBubbleProps) {
  // Tail geometry in its own little box; x0 is where it leaves the body.
  const x0 = TW * 0.55 + 3;
  const base = 4;
  const tip = base + 2 + TH;
  const d = `M${x0} ${base}Q${x0} ${base + TH * 0.6} ${x0 - TW * 0.55} ${tip}Q${x0 + TW * 0.25} ${base + TH * 0.55} ${x0 + TW} ${base}`;
  const offset = R * 0.9 - x0;
  return (
    <div
      className={`relative inline-block max-w-full ${className}`}
      style={{ filter: `drop-shadow(3px 4px 0 ${INK})`, ...style }}
    >
      <div
        className="relative rounded-[22px] border-[2.6px] border-ink bg-white px-[18px] py-[12px] text-left font-bold leading-snug text-ink"
        style={marker ? { borderLeft: `9px solid ${marker}` } : undefined}
      >
        {children}
      </div>
      {tail && (
        <svg
          aria-hidden
          width={TW + x0 + 4}
          height={tip + 3}
          viewBox={`0 0 ${TW + x0 + 4} ${tip + 3}`}
          className="absolute"
          style={{
            top: `calc(100% - ${base + 2.6}px)`,
            [side === 'left' ? 'left' : 'right']: offset,
            transform: side === 'right' ? 'scaleX(-1)' : undefined,
          }}
        >
          <path d={`${d}L${x0 + TW} 0L${x0} 0Z`} fill="#fff" />
          <path d={d} fill="none" stroke={INK} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </div>
  );
}
