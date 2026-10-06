'use client';

import { m, useScroll, useTransform } from 'motion/react';
import { useRef } from 'react';

const LINES: readonly [string, string, string?][] = [
  ['Recording', '$0.00', 'on your Mac'],
  ['Transcription', '$0.00', 'on your Mac'],
  ['Summary', '$0.02', 'one small AI call'],
  ['Audio storage', '$0.0002', 'a month, if you keep it'],
  ['Your attention', '$0.00', 'nobody needed it'],
];

const POINTS: readonly { title: string; body: string }[] = [
  {
    title: 'No bot joins your call',
    body: 'Nobody gets the “Notetaker has joined the meeting” moment. The Mac app listens the way your ears do: from your side of the call.',
  },
  {
    title: 'Speech becomes text on your Mac',
    body: 'The transcript is made on the device and only the text is uploaded. Keeping the audio for playback is up to you.',
  },
  {
    title: 'Audio skips our servers',
    body: 'If you keep it, the recording goes straight from your Mac or browser to private storage through a one-time link. Delete the meeting and it goes too.',
  },
];

/** Privacy and cost: an itemised receipt for one hour of meeting, drifting at its own depth. */
export function Receipt() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const y = useTransform(scrollYProgress, [0, 1], [90, -90]);
  const rotate = useTransform(scrollYProgress, [0, 1], [5, -3]);

  return (
    <section ref={ref} aria-labelledby="receipt-title" className="relative overflow-hidden bg-paper py-24 sm:py-32">
      <div className="mx-auto grid max-w-[1150px] items-center gap-14 px-5 sm:px-8 lg:grid-cols-[5fr_6fr] lg:gap-20">
        <m.figure style={{ y, rotate }} className="mx-auto w-full max-w-[380px]" aria-label="Receipt for one hour of meeting">
          <div style={{ filter: 'drop-shadow(5px 6px 0 #292133)' }}>
          <div className="receipt bg-white px-6 pt-7 pb-10 font-mono text-[0.86rem] text-ink">
            <p className="font-display text-center text-3xl tracking-tight">BoringTalks</p>
            <p className="mt-1 text-center text-xs">boringtalks.lol</p>
            <p className="mt-4 border-y-2 border-dashed border-ink/40 py-2 text-center">1 meeting, 60 min, 4 people</p>
            <dl className="mt-3 space-y-2.5">
              {LINES.map(([what, price, note]) => (
                <div key={what}>
                  <div className="flex items-baseline gap-2">
                    <dt className="font-bold">{what}</dt>
                    <span className="flex-1 border-b-2 border-dotted border-ink/30" aria-hidden />
                    <dd className="font-bold tabular-nums">{price}</dd>
                  </div>
                  {note && <p className="text-xs text-ink-soft">{note}</p>}
                </div>
              ))}
            </dl>
            <div className="mt-4 flex items-baseline justify-between border-t-2 border-dashed border-ink/40 pt-3 text-base font-extrabold">
              <span>Total</span>
              <span className="tabular-nums">about 2¢</span>
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
          <h2 id="receipt-title" className="font-display text-[2.5rem] leading-[1.02] text-ink sm:text-6xl">
            Costs about two cents. Leaks about nothing.
          </h2>
          <p className="mt-5 max-w-[52ch] text-lg leading-relaxed font-semibold text-ink-soft">
            The expensive part of meeting notes is turning speech into text. Your Mac already has a chip for that, so we let it do the work and keep the
            server for the cheap part.
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
