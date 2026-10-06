'use client';

import { m, useScroll, useTransform } from 'motion/react';
import { useRef } from 'react';

/** What one long meeting turns into, itemised. */
const LINES: readonly [string, string, string?][] = [
  ['Title that says something', '×1', '“Pricing review: Pro to $29, launch Nov 3”'],
  ['Summary', '×1', 'three lines, no fluff'],
  ['Names put to voices', '×4', 'You, Maya, Leo, Dana'],
  ['Tasks with owners', '×4', 'and when they’re due'],
  ['Decisions', '×2', 'in writing, finally'],
  ['Notes you took', '×0', 'you were busy nodding'],
];

const POINTS: readonly { title: string; body: string }[] = [
  {
    title: 'Every task in one list',
    body: 'Action items from all your meetings land on one page, soonest due first, each linked to the moment it was promised.',
  },
  {
    title: 'See where your week went',
    body: 'A calendar shows how many meetings you had each day and how many hours they ate. Bring it to your next “quick sync” about meetings.',
  },
  {
    title: 'Find anything later',
    body: 'Search every word that was said, or click a person or a topic to see every meeting they came up in.',
  },
  {
    title: 'No bot joins your call',
    body: 'Nobody gets the “Notetaker has joined the meeting” moment. The Mac app listens from your side of the call, the way you do.',
  },
];

/** What you walk away with: an itemised receipt for one meeting, drifting at its own depth. */
export function WhatYouGet() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const y = useTransform(scrollYProgress, [0, 1], [90, -90]);
  const rotate = useTransform(scrollYProgress, [0, 1], [5, -3]);

  return (
    <section ref={ref} aria-labelledby="get-title" className="relative overflow-hidden bg-paper py-24 sm:py-32">
      <div className="mx-auto grid max-w-[1150px] items-center gap-14 px-5 sm:px-8 lg:grid-cols-[5fr_6fr] lg:gap-20">
        <m.figure style={{ y, rotate }} className="mx-auto w-full max-w-[380px]" aria-label="What one meeting turns into">
          <div style={{ filter: 'drop-shadow(5px 6px 0 #292133)' }}>
            <div className="receipt bg-white px-6 pt-7 pb-10 font-mono text-[0.86rem] text-ink">
              <p className="font-display text-center text-3xl tracking-tight">BoringTalks</p>
              <p className="mt-1 text-center text-xs">boringtalks.lol</p>
              <p className="mt-4 border-y-2 border-dashed border-ink/40 py-2 text-center">1 “quick sync”, 58 min, 4 people</p>
              <dl className="mt-3 space-y-2.5">
                {LINES.map(([what, count, note]) => (
                  <div key={what}>
                    <div className="flex items-baseline gap-2">
                      <dt className="font-bold">{what}</dt>
                      <span className="flex-1 border-b-2 border-dotted border-ink/30" aria-hidden />
                      <dd className="font-bold tabular-nums">{count}</dd>
                    </div>
                    {note && <p className="text-xs text-ink-soft">{note}</p>}
                  </div>
                ))}
              </dl>
              <div className="mt-4 flex items-baseline justify-between border-t-2 border-dashed border-ink/40 pt-3 text-base font-extrabold">
                <span>You get back</span>
                <span className="tabular-nums">58 min</span>
              </div>
              <p className="mt-5 text-center text-xs">Thank you for not taking notes.</p>
              <svg viewBox="0 0 200 34" className="mx-auto mt-3 h-9 w-48" aria-hidden>
                {Array.from({ length: 42 }, (_, i) => (
                  <rect key={i} x={i * 4.8} y={0} width={(i * 7) % 3 === 0 ? 3 : 1.4} height={34} fill="#292133" />
                ))}
              </svg>
            </div>
          </div>
        </m.figure>

        <div>
          <h2 id="get-title" className="font-display text-[2.5rem] leading-[1.02] text-ink sm:text-6xl">
            Everything you’d have written down. None of the writing.
          </h2>
          <p className="mt-5 max-w-[52ch] text-lg leading-relaxed font-semibold text-ink-soft">
            Each meeting lands in your dashboard with who was there, what was decided and who promised what. The rest of the app keeps it all findable.
          </p>
          <ul className="mt-8 space-y-4">
            {POINTS.map((pt) => (
              <li key={pt.title} className="flex gap-4">
                <span className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full border-[2.5px] border-ink bg-mint" aria-hidden>
                  <svg viewBox="0 0 16 16" className="h-4 w-4">
                    <path d="M3 8.5L6.5 12L13 4" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <div>
                  <h3 className="text-lg font-extrabold text-ink">{pt.title}</h3>
                  <p className="mt-0.5 leading-relaxed font-semibold text-ink-soft">{pt.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
