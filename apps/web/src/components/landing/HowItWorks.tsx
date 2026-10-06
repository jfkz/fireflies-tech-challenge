'use client';

import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';
import { m, useMotionValue, useMotionValueEvent, useScroll, useTransform, type MotionValue } from 'motion/react';
import { useRef, useState, type ReactNode } from 'react';
import { TalkingHead } from '@/components/avatar/TalkingHead';
import { LISTENER, TALKER } from '@/lib/avatar/styles';
import { DEMO_SUMMARY, DEMO_TRANSCRIPT, howStepAt, type HowStep } from '@/lib/landing/story';

const STEPS: readonly { title: string; body: ReactNode }[] = [
  {
    title: 'Your Mac records both sides',
    body: (
      <>
        Start a meeting from the menu bar. Your microphone becomes “You”, whatever the call plays becomes Speaker 1, 2, 3. Zoom, Meet, Teams, a
        podcast you pretend is work: it doesn’t care which app.
      </>
    ),
  },
  {
    title: 'It’s transcribed on your Mac',
    body: (
      <>
        A speech model runs on the Mac’s own chip, so turning an hour of talk into text costs nothing and nobody is billed per minute. Voices are told
        apart on the device too.
      </>
    ),
  },
  {
    title: 'The server writes the boring part',
    body: (
      <>
        Only the text goes up. One small AI call turns it into a title that actually says something, a summary, key topics, action items with owners,
        and the decisions everyone will later claim they never agreed to.
      </>
    ),
  },
];

/**
 * Three scroll-driven steps beside a little Mac window that records, then
 * transcribes, then assembles the summary card out of the transcript.
 */
export function HowItWorks() {
  return usePrefersReducedMotion() ? <HowItWorksStill /> : <HowItWorksAnimated />;
}

function HowItWorksAnimated() {
  const track = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: track, offset: ['start start', 'end end'] });
  const [step, setStep] = useState<HowStep>(0);
  useMotionValueEvent(scrollYProgress, 'change', (v) => {
    const next = howStepAt(v);
    setStep((s) => (s === next ? s : next));
  });
  const bg = useTransform(scrollYProgress, [0, 0.45, 1], ['#241f57', '#3845db', '#5b67f5']);

  return (
    <section id="how" aria-labelledby="how-title">
      <div ref={track} className="scrolly" style={{ ['--scrolly-height' as string]: '380vh' }}>
        <m.div className="scrolly-stage" style={{ backgroundColor: bg }}>
          <div className="mx-auto grid h-full max-w-[1300px] grid-rows-[auto_1fr] gap-5 px-4 pt-20 pb-6 sm:px-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:grid-rows-1 lg:items-center lg:gap-14 lg:pt-0">
            <div>
              <h2 id="how-title" className="font-display text-4xl leading-none text-white sm:text-5xl lg:text-6xl">
                How it works
              </h2>
              <ol className="mt-5 space-y-3 lg:mt-8">
                {STEPS.map((s, i) => {
                  const active = i === step;
                  return (
                    <li
                      key={s.title}
                      className={`rounded-[20px] border-[2.5px] transition-[background-color,border-color,opacity] duration-300 ${
                        active ? 'border-ink bg-white text-ink shadow-[4px_5px_0_0_var(--color-ink)]' : 'border-transparent text-white/60 max-lg:hidden'
                      } px-4 py-3 sm:px-5 sm:py-4`}
                      aria-current={active ? 'step' : undefined}
                    >
                      <p className="flex items-baseline gap-3 text-lg font-extrabold sm:text-xl">
                        <span className={`font-display text-2xl ${active ? 'text-call' : ''}`}>{i + 1}</span>
                        {s.title}
                      </p>
                      <p className={`mt-1.5 leading-relaxed font-semibold text-ink-soft ${active ? '' : 'hidden'} max-sm:text-[0.95rem]`}>{s.body}</p>
                    </li>
                  );
                })}
              </ol>
            </div>
            <div className="relative min-h-0">
              <MacWindow title={['Recording 0:42', 'Transcript', 'Summary'][step]}>
                <Layer p={scrollYProgress} show={[null, null, 0.3, 0.33]}>
                  <RecordingPanel />
                </Layer>
                <Layer p={scrollYProgress} show={[0.33, 0.36, 0.63, 0.66]}>
                  <TranscriptPanel p={scrollYProgress} from={0.36} to={0.6} />
                </Layer>
                <Layer p={scrollYProgress} show={[0.66, 0.69, null, null]}>
                  <SummaryPanel p={scrollYProgress} from={0.69} to={0.95} />
                </Layer>
              </MacWindow>
            </div>
          </div>
        </m.div>
      </div>
    </section>
  );
}

/** Visible between show[1] and show[2], fading in/out over the edges (null = no fade on that side). */
function Layer({ p, show, children }: { p: MotionValue<number>; show: [number | null, number | null, number | null, number | null]; children: ReactNode }) {
  const [a, b, c, d] = show;
  // Offsets passed to Motion must stay within 0…1 and never decrease.
  const keys = [a ?? 0, b ?? 0, c ?? 1, d ?? 1];
  const opacity = useTransform(p, keys, [a === null ? 1 : 0, 1, 1, d === null ? 1 : 0]);
  const y = useTransform(p, keys, [a === null ? 0 : 40, 0, 0, d === null ? 0 : -40]);
  const visibility = useTransform(opacity, (o) => (o < 0.01 ? 'hidden' : 'visible'));
  return (
    <m.div className="absolute inset-0 p-4 sm:p-6" style={{ opacity, y, visibility }}>
      {children}
    </m.div>
  );
}

export function MacWindow({ title, children, still = false }: { title: string; children: ReactNode; still?: boolean }) {
  return (
    <div className="sticker overflow-hidden" style={{ boxShadow: 'var(--shadow-hard-lg)' }}>
      <div className="flex items-center gap-2 border-b-[2.5px] border-ink bg-paper px-4 py-2.5">
        {['#ff6a5f', '#ffbd2e', '#28c840'].map((c) => (
          <span key={c} className="h-3 w-3 rounded-full border-2 border-ink" style={{ background: c }} />
        ))}
        <span className="ml-3 truncate text-sm font-extrabold text-ink-soft">BoringTalks: {title}</span>
      </div>
      <div className={still ? 'p-4 sm:p-6' : 'relative h-[min(52svh,440px)] sm:h-[min(56svh,460px)]'}>{children}</div>
    </div>
  );
}

function Meter({ delay = 0, color }: { delay?: number; color: string }) {
  return (
    <div className="flex h-8 items-center justify-center gap-1" aria-hidden>
      {Array.from({ length: 9 }, (_, i) => (
        <span
          key={i}
          className="animate-meter block h-full w-1.5 origin-center rounded-full"
          style={{ background: color, animationDelay: `${delay + ((i * 137) % 9) * 0.07}s` }}
        />
      ))}
    </div>
  );
}

export function RecordingPanel() {
  return (
    <div className="flex h-full flex-col">
      <p className="flex items-center gap-2 text-sm font-extrabold text-danger">
        <span className="animate-pulse-dot h-3 w-3 rounded-full bg-danger" /> Recording both channels
      </p>
      <div className="grid flex-1 grid-cols-2 items-end gap-4">
        {[
          { style: TALKER, who: 'You', how: 'Microphone', color: TALKER.shirt, look: 1 },
          { style: LISTENER, who: 'Speaker 1', how: 'System audio', color: LISTENER.shirt, look: -1 },
        ].map((h, i) => (
          <div key={h.who} className="text-center">
            <TalkingHead style={h.style} talking look={h.look} seed={20 + i} className="mx-auto aspect-square w-[min(100%,190px)]" />
            <Meter color={h.color} delay={i * 0.3} />
            <p className="mt-1 text-base font-extrabold text-ink">{h.who}</p>
            <p className="text-sm font-bold text-ink-soft">{h.how}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TranscriptPanel({ p, from, to }: { p: MotionValue<number>; from: number; to: number }) {
  const span = (to - from) / DEMO_TRANSCRIPT.length;
  return (
    <div className="flex h-full flex-col">
      <ul className="flex-1 space-y-2.5 overflow-hidden">
        {DEMO_TRANSCRIPT.map((line, i) => (
          <TranscriptLine key={line.at} p={p} start={from + i * span} end={from + (i + 0.6) * span} line={line} />
        ))}
      </ul>
      <p className="mt-3 self-start rounded-full border-2 border-ink bg-mint-soft px-3 py-1 text-xs font-extrabold text-ink sm:text-sm">
        Transcribed on this Mac: $0.00 a minute
      </p>
    </div>
  );
}

function TranscriptLine({ p, start, end, line }: { p: MotionValue<number>; start: number; end: number; line: (typeof DEMO_TRANSCRIPT)[number] }) {
  // Each line arrives as a speech bubble that drops in and settles into the transcript.
  const opacity = useTransform(p, [start, end], [0, 1]);
  const y = useTransform(p, [start, end], [-36, 0]);
  const scale = useTransform(p, [start, end], [0.85, 1]);
  const you = line.speaker === 'You';
  return (
    <m.li className="flex gap-3 text-[0.92rem] leading-snug sm:text-base" style={{ opacity, y, scale, originX: 0 }}>
      <span className="w-9 shrink-0 pt-0.5 text-right text-xs font-extrabold text-ink-soft tabular-nums sm:text-sm">{line.at}</span>
      <span className="rounded-2xl border-2 border-ink bg-white px-3 py-1.5 font-semibold text-ink">
        <span className="font-extrabold" style={{ color: you ? TALKER.shirt : LISTENER.shirt }}>
          {line.speaker}:
        </span>{' '}
        {line.text}
      </span>
    </m.li>
  );
}

export function SummaryPanel({ p, from, to }: { p: MotionValue<number>; from: number; to: number }) {
  const at = (k: number) => from + (to - from) * k;
  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden text-ink">
      <FlyIn p={p} range={[at(0), at(0.18)]}>
        <h3 className="font-display text-xl leading-tight sm:text-2xl">{DEMO_SUMMARY.title}</h3>
      </FlyIn>
      <FlyIn p={p} range={[at(0.12), at(0.3)]}>
        <p className="text-sm leading-relaxed font-semibold text-ink-soft sm:text-base">{DEMO_SUMMARY.description}</p>
      </FlyIn>
      <FlyIn p={p} range={[at(0.25), at(0.45)]}>
        <p className="mb-1.5 text-sm font-extrabold">Action items</p>
        <ul className="space-y-1.5">
          {DEMO_SUMMARY.actionItems.map((a, i) => (
            <ActionRow key={a.text} p={p} doneAt={at(0.7 + i * 0.12)} item={a} />
          ))}
        </ul>
      </FlyIn>
      <FlyIn p={p} range={[at(0.4), at(0.6)]}>
        <p className="mb-1.5 text-sm font-extrabold">Decisions</p>
        <ul className="flex flex-wrap gap-2">
          {DEMO_SUMMARY.decisions.map((d) => (
            <li key={d} className="rounded-full border-2 border-ink bg-sun-soft px-3 py-1 text-xs font-bold sm:text-sm">
              {d}
            </li>
          ))}
        </ul>
      </FlyIn>
    </div>
  );
}

function FlyIn({ p, range, children }: { p: MotionValue<number>; range: [number, number]; children: ReactNode }) {
  const opacity = useTransform(p, range, [0, 1]);
  const x = useTransform(p, range, [-70, 0]);
  const rotate = useTransform(p, range, [-4, 0]);
  return <m.div style={{ opacity, x, rotate }}>{children}</m.div>;
}

function ActionRow({ p, doneAt, item }: { p: MotionValue<number>; doneAt: number; item: (typeof DEMO_SUMMARY.actionItems)[number] }) {
  const tick = useTransform(p, [doneAt - 0.02, doneAt], [0, 1]);
  return (
    <li className="flex items-center gap-2.5 text-sm font-bold sm:text-base">
      <span className="relative grid h-5 w-5 shrink-0 place-items-center rounded-md border-2 border-ink bg-white">
        <m.svg viewBox="0 0 16 16" className="absolute h-4 w-4" style={{ opacity: tick, scale: tick }} aria-hidden>
          <path d="M3 8.5L6.5 12L13 4" fill="none" stroke="#2db3a3" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
        </m.svg>
      </span>
      <span>{item.text}</span>
      <span className="ml-auto shrink-0 rounded-full bg-paper px-2 py-0.5 text-xs font-extrabold text-ink-soft">
        {item.owner}, {item.due}
      </span>
    </li>
  );
}

/** Reduced motion: the three steps as a plain list, each with its finished picture. */
function HowItWorksStill() {
  const done = useMotionValue(1);
  return (
    <section id="how" aria-labelledby="how-title" className="bg-call-deep px-4 py-20 sm:px-8">
      <div className="mx-auto max-w-[1100px]">
        <h2 id="how-title" className="font-display text-5xl leading-none text-white">
          How it works
        </h2>
        <ol className="mt-10 space-y-10">
          {STEPS.map((s, i) => (
            <li key={s.title} className="grid gap-6 lg:grid-cols-[5fr_7fr] lg:items-center">
              <div className="rounded-[20px] border-[2.5px] border-ink bg-white px-5 py-4 text-ink shadow-[4px_5px_0_0_var(--color-ink)]">
                <p className="flex items-baseline gap-3 text-xl font-extrabold">
                  <span className="font-display text-2xl text-call">{i + 1}</span>
                  {s.title}
                </p>
                <p className="mt-1.5 leading-relaxed font-semibold text-ink-soft">{s.body}</p>
              </div>
              <MacWindow title={['Recording 0:42', 'Transcript', 'Summary'][i]} still>
                {i === 0 ? <RecordingPanel /> : i === 1 ? <TranscriptPanel p={done} from={0} to={0.5} /> : <SummaryPanel p={done} from={0} to={0.5} />}
              </MacWindow>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
