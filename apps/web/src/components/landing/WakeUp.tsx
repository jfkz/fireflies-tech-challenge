'use client';

import { m, useInView, useScroll, useTransform } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { TalkingHead } from '@/components/avatar/TalkingHead';
import { SpeechBubble } from '@/components/avatar/SpeechBubble';
import { SEATS } from './MeetingStory';

const CONFETTI = [
  { x: '6%', y: 10, c: '#ff6a3d', r: 20, d: 0.6, s: 'M0 0h22v10H0z' },
  { x: '18%', y: 70, c: '#5b67f5', r: -30, d: 1.4, s: 'M11 0l11 20H0z' },
  { x: '30%', y: 25, c: '#2db3a3', r: 50, d: 0.9, s: 'M0 0h10v26H0z' },
  { x: '47%', y: 5, c: '#ff8ca0', r: 10, d: 1.8, s: 'M11 0a11 11 0 1 0 .1 0z' },
  { x: '62%', y: 60, c: '#292133', r: -45, d: 0.7, s: 'M0 0h22v10H0z' },
  { x: '76%', y: 18, c: '#ff6a3d', r: 70, d: 1.5, s: 'M11 0l11 20H0z' },
  { x: '88%', y: 52, c: '#5b67f5', r: 25, d: 1.1, s: 'M0 0h10v26H0z' },
  { x: '94%', y: 8, c: '#2db3a3', r: -60, d: 2, s: 'M11 0a11 11 0 1 0 .1 0z' },
] as const;

const WOKEN = 'Wait, it wrote down who’s doing what?';

/** What each head shouts when it wakes up, in the order they speak. */
const CHEERS: readonly (readonly [number, string])[] = [
  [1, WOKEN],
  [3, 'Woo hoo!'],
  [0, 'Finally!'],
  [2, 'Best meeting ever.'],
];

/** Index into CHEERS of the head speaking now, -1 before the section shows up. */
function useCheers(active: boolean): number {
  const [turn, setTurn] = useState(-1);
  useEffect(() => {
    if (!active) return;
    let k = 0;
    const next = () => setTurn(k < CHEERS.length ? k++ : -1);
    next();
    const id = setInterval(next, 1500);
    return () => clearInterval(id);
  }, [active]);
  return active ? turn : -1;
}

/** The heads wake up and cheer when the summary arrives. Confetti falls at different depths. */
export function WakeUp() {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { amount: 0.35, once: true });
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const turn = useCheers(inView);
  const cheer = turn >= 0 ? CHEERS[turn] : null;

  return (
    <section ref={ref} aria-labelledby="wake-title" className="relative overflow-hidden bg-sun pt-24 sm:pt-32">
      {CONFETTI.map((c, i) => (
        <Confetti key={i} {...c} p={scrollYProgress} />
      ))}
      <div className="relative z-10 mx-auto max-w-3xl px-5 text-center">
        <h2 id="wake-title" className="font-display text-[2.6rem] leading-[1] text-ink sm:text-6xl lg:text-7xl">
          Then everybody wakes up for the summary.
        </h2>
        <p className="mx-auto mt-5 max-w-[52ch] text-lg leading-relaxed font-semibold text-ink/80">
          A minute after you hang up, the meeting is in your dashboard with a title that says what happened, a short summary, key topics, action items
          with owners and due dates, and the decisions. An email too, if you want one.
        </p>
      </div>
      <div className="relative z-10 mx-auto mt-14 flex max-w-[1000px] items-end justify-center px-2 [--head:24vw] sm:[--head:min(19vw,220px)]">
        {SEATS.map((style, i) => (
          <m.div
            key={style.name}
            className="relative -mx-[1.2vw] w-[var(--head)] sm:-mx-1"
            initial={{ y: '45%' }}
            animate={inView ? { y: 0 } : undefined}
            transition={{ type: 'spring', stiffness: 300, damping: 14, delay: i * 0.12 }}
          >
            {i === 1 && (
              <div className="absolute bottom-[94%] left-[40%] z-20 w-max max-w-[60vw] text-sm sm:text-base">
                <SpeechBubble>{WOKEN}</SpeechBubble>
              </div>
            )}
            <TalkingHead
              style={style}
              cheering={inView}
              asleep={!inView}
              seed={40 + i}
              line={cheer?.[0] === i ? cheer[1] : undefined}
              className="aspect-square w-full"
            />
          </m.div>
        ))}
      </div>
      <div className="relative z-10 h-6 border-t-[3px] border-ink bg-call-deep" aria-hidden />
    </section>
  );
}

function Confetti({ x, y, c, r, d, s, p }: { x: string; y: number; c: string; r: number; d: number; s: string; p: ReturnType<typeof useScroll>['scrollYProgress'] }) {
  // Deeper pieces (bigger d) travel further: that's the parallax.
  const ty = useTransform(p, [0, 1], [-140 * d, 260 * d]);
  const rot = useTransform(p, [0, 1], [r, r + 200 * d]);
  return (
    <m.svg
      viewBox="-2 -2 26 30"
      className="pointer-events-none absolute w-6 sm:w-8"
      style={{ left: x, top: `${y}%`, y: ty, rotate: rot, scale: 0.7 + d * 0.3 }}
      aria-hidden
    >
      <path d={s} fill={c} stroke="#292133" strokeWidth={2.5} strokeLinejoin="round" />
    </m.svg>
  );
}
