'use client';

import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';
import Link from 'next/link';
import { AnimatePresence, m, useMotionValue, useMotionValueEvent, useScroll, useTransform } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { SpeechBubble } from '@/components/avatar/SpeechBubble';
import { TalkingHead } from '@/components/avatar/TalkingHead';
import { TypeLine } from '@/components/avatar/TypeLine';
import { MEN, WOMEN, type AvatarStyle } from '@/lib/avatar/styles';
import { CHATTER, clockMinutes, MEETING_BEATS, meetingBeatAt, type HeadMood, type MeetingBeat } from '@/lib/landing/story';
import { Mug, OfficeWindow, Plant, WallClock, Whiteboard } from './RoomArt';

/** The four people stuck in this meeting, left to right. */
export const SEATS: readonly AvatarStyle[] = [WOMEN[2], MEN[2], MEN[3], WOMEN[0]];

/** Cycles through the hero's clichés while `active`. Returns the index of the current line. */
function useChatter(active: boolean, intervalMs = 2900): number {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % CHATTER.length), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
  return index;
}

function headProps(mood: HeadMood, i: number, speaker: number | null) {
  const towardSpeaker = speaker === null || speaker === i ? 0 : Math.sign(speaker - i);
  switch (mood) {
    case 'chatty':
      return speaker === i ? { talking: true, look: 'cursor' as const } : { look: towardSpeaker };
    case 'listening':
      return { look: towardSpeaker };
    case 'yawning':
      return { yawning: true, look: 0 };
    case 'asleep':
      return { asleep: true, look: 0 };
    case 'cheering':
      return { cheering: true, look: 0 };
  }
}

/**
 * Hero + "the meeting drags on": a sticky meeting room. As you scroll, the
 * clock runs from 5 to 58 minutes, the room dims, heads yawn and nod off, mugs
 * float past in the foreground, and the punchline lands.
 */
export function MeetingStory() {
  const track = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  const { scrollYProgress } = useScroll({ target: track, offset: ['start start', 'end end'] });
  const stillProgress = useMotionValue(0);
  const p = reduced ? stillProgress : scrollYProgress;

  const [beat, setBeat] = useState<MeetingBeat>(MEETING_BEATS[0]);
  useMotionValueEvent(scrollYProgress, 'change', (v) => {
    const next = meetingBeatAt(v);
    setBeat((prev) => (prev.index === next.index ? prev : next));
  });
  const shownBeat = reduced ? MEETING_BEATS[0] : beat;
  const chatter = useChatter(!reduced && shownBeat.index === 0);
  const chatIndex = reduced ? 1 : chatter;

  // Layers at different depths.
  const minutes = useTransform(p, (v) => clockMinutes(v));
  const bg = useTransform(p, [0.08, 0.62], ['#5b67f5', '#241f57']);
  const sky = useTransform(p, [0.1, 0.6], ['#9fd8ff', '#1a1640']);
  const droop = useTransform(p, [0.15, 0.7], [0, 1]);
  const wallY = useTransform(p, [0, 1], ['0%', '-8%']);
  const headsY = useTransform(p, [0, 1], ['0%', '-3%']);
  const heroOpacity = useTransform(p, [0.07, 0.15], [1, 0]);
  const heroY = useTransform(p, [0, 0.15], [0, -90]);
  const mugY1 = useTransform(p, [0, 1], ['70vh', '-140vh']);
  const mugY2 = useTransform(p, [0, 1], ['110vh', '-200vh']);
  const mugY3 = useTransform(p, [0.2, 1], ['120vh', '-90vh']);
  const mugR = useTransform(p, [0, 1], [-20, 50]);
  const dim = useTransform(p, [0.62, 0.72], [0, 0.55]);

  const speaker = shownBeat.index === 0 ? CHATTER[chatIndex][0] : (shownBeat.line?.head ?? null);
  const current = shownBeat.index === 0 ? { head: CHATTER[chatIndex][0], text: CHATTER[chatIndex][1] } : shownBeat.line;
  const previous = shownBeat.index === 0 ? CHATTER[(chatIndex + CHATTER.length - 1) % CHATTER.length] : null;

  return (
    <section aria-labelledby="hero-title">
      <div ref={track} className="scrolly" style={{ ['--scrolly-height' as string]: '460vh' }}>
        <m.div className="scrolly-stage isolate" style={{ backgroundColor: bg }}>
          {/* Back wall: slowest layer. */}
          <m.div className="pointer-events-none absolute inset-0" style={{ y: wallY }} aria-hidden>
            <OfficeWindow sky={sky} className="absolute top-[9%] left-[46%] hidden w-[10.5vw] max-w-[170px] lg:block" />
            <Whiteboard className="absolute top-[11%] right-[15%] hidden w-[21vw] max-w-[300px] -rotate-1 md:block" />
            <WallClock minutes={minutes} className="absolute top-[3.6rem] right-4 w-[64px] sm:top-[11%] sm:right-[3.5%] sm:w-[7.5vw] sm:max-w-[112px]" />
            <Plant droop={droop} className="absolute right-[2%] bottom-[19%] hidden w-[9vw] max-w-[130px] md:block" />
          </m.div>

          {/* Hero copy. */}
          <m.div
            className="relative z-30 mx-auto max-w-[1400px] px-4 pt-24 sm:px-8 sm:pt-[17vh] lg:px-[6%]"
            style={reduced ? undefined : { opacity: heroOpacity, y: heroY }}
          >
            <div className="max-w-[min(600px,40vw)] max-lg:max-w-[560px]">
              <h1 id="hero-title" className="font-display text-[2.6rem] leading-[0.98] text-white sm:text-6xl lg:text-[4.6rem]">
                Your meeting, minus the meeting.
              </h1>
              <p className="mt-4 max-w-[46ch] text-[1.05rem] leading-relaxed font-semibold text-white/90 sm:text-lg">
                BoringTalks records the call on your Mac, writes it all down, and hands you a title, a summary and who promised what. You can keep
                nodding.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <a href="#download" className="btn btn-primary btn-lg">
                  <DownloadGlyph /> Download for Mac
                </a>
                <Link href="/signup" className="btn btn-secondary btn-lg">
                  Try it in the browser
                </Link>
              </div>
            </div>
          </m.div>

          {/* Story captions: sticky notes slapped on the wall. */}
          <div className="pointer-events-none absolute inset-x-0 top-[13%] z-40 flex justify-center px-4 sm:top-[16%] lg:top-[24%] lg:justify-start lg:pl-[6%]" aria-live="polite">
            <AnimatePresence mode="wait">
              {shownBeat.caption && (
                <m.p
                  key={shownBeat.caption}
                  initial={{ opacity: 0, y: -30, rotate: -6, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, rotate: -2, scale: 1 }}
                  exit={{ opacity: 0, y: 20, rotate: 3 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 24 }}
                  className="max-w-[30rem] rounded-md border-[2.5px] border-ink bg-sun px-5 py-4 text-lg leading-snug font-extrabold text-ink shadow-[5px_6px_0_0_var(--color-ink)] sm:text-[1.35rem]"
                >
                  <CaptionText text={shownBeat.caption} />
                </m.p>
              )}
            </AnimatePresence>
          </div>

          {/* The punchline. */}
          <m.div className="pointer-events-none absolute inset-0 z-[35] bg-dusk-deep" style={{ opacity: dim }} aria-hidden />
          <AnimatePresence>
            {shownBeat.statement && (
              <m.div
                key="statement"
                className="absolute inset-x-0 top-[12%] z-40 px-5 text-center sm:top-[16%]"
                initial={{ opacity: 0, scale: 0.85, y: 30 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ type: 'spring', stiffness: 260, damping: 22 }}
              >
                <h2 className="font-display mx-auto max-w-[14ch] text-[2.7rem] leading-[1] text-white sm:text-7xl lg:text-[5.4rem]">
                  Meetings are boring.
                </h2>
                <p className="font-display mx-auto mt-4 max-w-[22ch] text-2xl leading-tight text-sun sm:text-4xl">
                  Notes about them shouldn’t be your job.
                </p>
              </m.div>
            )}
          </AnimatePresence>

          {/* The people, then the table in front of them. */}
          <m.div
            className="absolute inset-x-0 bottom-0 z-20 [--head:26vw] sm:[--head:min(19vw,250px)] lg:[--head:min(16vw,240px)]"
            style={{ y: headsY }}
          >
            <div className="relative mx-auto flex max-w-[1400px] items-end justify-center px-2 lg:justify-end lg:pr-[7%]">
              {SEATS.map((style, i) => {
                const mood = shownBeat.heads[i];
                const isCurrent = current?.head === i;
                const isPrevious = !isCurrent && previous?.[0] === i;
                const side = i < 2 ? 'left' : 'right';
                return (
                  <m.div
                    key={style.name}
                    className="relative -mx-[1.5vw] w-[var(--head)] sm:-mx-1"
                    initial={{ y: '110%' }}
                    animate={{ y: 0 }}
                    transition={{ type: 'spring', stiffness: 260, damping: 20, delay: 0.25 + i * 0.09 }}
                  >
                    <TalkingHead style={style} seed={i + 3} {...headProps(mood, i, speaker)} className="aspect-square w-full" />
                    {(isCurrent || isPrevious) && current && (
                      <div
                        className={`absolute bottom-[92%] z-30 w-max max-w-[min(62vw,280px)] text-[0.92rem] sm:text-base ${
                          side === 'left' ? 'left-[38%]' : 'right-[38%]'
                        } ${isPrevious ? 'hidden opacity-55 lg:block' : ''}`}
                        style={isPrevious ? { bottom: '128%' } : undefined}
                      >
                        <SpeechBubble side={side}>
                          {isPrevious ? previous![1] : <TypeLine key={current.text} text={current.text} />}
                        </SpeechBubble>
                      </div>
                    )}
                  </m.div>
                );
              })}
            </div>
            <Table />
          </m.div>

          {/* Foreground: mugs drifting past faster than anything else. */}
          <div className="motion-only pointer-events-none absolute inset-0 z-[45] overflow-hidden" aria-hidden>
            <m.div className="absolute left-[3%] w-[16vw] max-w-[110px] sm:left-[7%]" style={{ y: mugY1, rotate: mugR }}>
              <Mug />
            </m.div>
            <m.div className="absolute right-[4%] w-[13vw] max-w-[90px] sm:right-[27%]" style={{ y: mugY2, rotate: mugR }}>
              <Mug color="#ffd140" />
            </m.div>
            <m.div className="absolute left-[38%] hidden w-[8vw] max-w-[80px] md:block" style={{ y: mugY3 }}>
              <Mug color="#c8f1ea" />
            </m.div>
          </div>
        </m.div>
      </div>

      {/* Without motion the story is told as plain text below the room. */}
      <div className="still-only bg-dusk px-5 py-16 text-white">
        <ol className="mx-auto max-w-2xl space-y-4 text-lg font-bold">
          {MEETING_BEATS.filter((b) => b.caption).map((b) => (
            <li key={b.index} className="rounded-md border-[2.5px] border-ink bg-sun px-5 py-4 text-ink">
              {b.caption}
            </li>
          ))}
        </ol>
        <h2 className="font-display mx-auto mt-12 max-w-2xl text-5xl leading-none">Meetings are boring.</h2>
        <p className="font-display mx-auto mt-3 max-w-2xl text-3xl text-sun">Notes about them shouldn’t be your job.</p>
      </div>
    </section>
  );
}

/** "Minute 12. Someone…" with the minute set in the display face. */
function CaptionText({ text }: { text: string }) {
  const [first, ...rest] = text.split('. ');
  return (
    <>
      <span className="font-display mr-1.5 font-normal">{first}.</span>
      {rest.join('. ')}
    </>
  );
}

function Table() {
  return (
    <div className="relative -mt-[calc(var(--head)*0.24)]" aria-hidden>
      <div className="relative h-[17svh] min-h-[96px] rounded-t-[36px] border-t-[3px] border-ink bg-call-deep sm:h-[20svh]">
        <div className="absolute inset-x-0 top-0 h-4 rounded-t-[36px] bg-[#7f89ff]" />
        <div className="absolute inset-x-0 top-4 h-[3px] bg-ink" />
        <div className="absolute top-[38%] left-1/2 -translate-x-1/2 -rotate-1 rounded-lg border-[2.5px] border-ink bg-sun-soft px-3 py-1 text-center text-[0.7rem] leading-tight font-extrabold whitespace-nowrap text-ink shadow-[2px_3px_0_0_var(--color-ink)] sm:text-sm">
          Meeting room 4B. HDMI cable missing since 2019.
        </div>
      </div>
    </div>
  );
}

/** A download arrow into a tray. */
export function DownloadGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden fill="none" stroke="currentColor" strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v11M7 10l5 5 5-5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
  );
}
