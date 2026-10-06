'use client';

import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { Emotion } from '@/lib/avatar/face';
import { useSound } from '@/components/landing/Sound';
import { PoseAnimator, stillPose, type Pose } from '@/lib/avatar/pose';
import type { AvatarStyle } from '@/lib/avatar/styles';
import { blipSchedule, lineDuration, mouthAt, voiceFor, type Blip, type Utterance } from '@/lib/landing/voice';
import { lookTowards, pointer, trackPointer } from '@/lib/pointer';
import { Avatar } from './Avatar';

export interface TalkingHeadProps {
  style: AvatarStyle;
  talking?: boolean;
  emotion?: Emotion;
  asleep?: boolean;
  yawning?: boolean;
  cheering?: boolean;
  /** Eyes shut in happy arcs, without the cheering bounce ("I'm not looking"). */
  eyesClosed?: boolean;
  /** A fixed direction (-1…1), 'cursor' to follow the pointer, or 'wander' to glance around. */
  look?: number | 'cursor' | 'wander';
  /** Seeds the blink schedule so a row of heads doesn't blink in unison. */
  seed?: number;
  className?: string;
  label?: string;
  /**
   * The line this head is saying right now. Each new line is "spoken": the mouth
   * follows its syllables, and on the landing page with sound on you hear a
   * gibberish voice too.
   */
  line?: string;
  /** Say `line` again every so many ms while on screen. */
  repeatEvery?: number;
}

interface Speech {
  line: string;
  start: number;
  blips: readonly Blip[];
  end: number;
  utterance: Utterance | null;
}

interface Frame {
  pose: Pose;
  look: number;
  lookY: number;
}

/** The pose a head holds when nothing animates (reduced motion, SSR, offscreen). */
export function restingFrame(p: Pick<TalkingHeadProps, 'emotion' | 'asleep' | 'yawning' | 'cheering' | 'eyesClosed' | 'look'>): Frame {
  return {
    pose: stillPose({
      emotion: p.cheering ? 'happy' : p.emotion,
      sleep: p.asleep ? 1 : 0,
      yawn: p.yawning && !p.asleep ? 1 : 0,
      joy: p.cheering || p.eyesClosed ? 1 : 0,
      time: 0.2,
    }),
    look: typeof p.look === 'number' ? p.look : 0,
    lookY: 0,
  };
}

/**
 * An animated head: blinks, glances around (or at the cursor), flaps its mouth
 * while `talking`, bobs and tilts. Runs at ~30 fps only while on screen, and holds
 * still for people who prefer reduced motion.
 */
export function TalkingHead(props: TalkingHeadProps) {
  const { style, className, label, seed = 1 } = props;
  const reduced = usePrefersReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<Frame>(() => restingFrame(props));
  const animator = useRef<PoseAnimator | null>(null);
  const visible = useRef(false);
  const speech = useRef<Speech | null>(null);
  const sound = useSound();

  /** Starts saying the current line (if there is one and the head is on screen). */
  const say = useEffectEvent(() => {
    const line = props.line?.trim();
    if (!line || !visible.current || reduced) return;
    speech.current?.utterance?.stop();
    const voice = voiceFor(seed);
    const blips = blipSchedule(line, voice);
    const utterance = sound?.on ? sound.engine.speak(blips, voice) : null;
    speech.current = { line, start: utterance?.startedAt ?? performance.now(), blips, end: lineDuration(line), utterance };
  });

  useEffect(() => {
    say();
    const id = props.repeatEvery ? setInterval(say, props.repeatEvery) : undefined;
    return () => {
      clearInterval(id);
      speech.current?.utterance?.stop();
      speech.current = null;
    };
  }, [props.line, props.repeatEvery]);

  const step = useEffectEvent((now: number) => {
    animator.current ??= new PoseAnimator(seed);
    const t = now / 1000;
    // A spoken line drives the mouth; without one, the synthetic flap does.
    const said = speech.current;
    const voiced = props.line ? (said ? mouthAt(said.blips, (now - said.start) / 1000) : 0) : undefined;
    const saying = said !== null && (now - said.start) / 1000 < said.end;
    const raw = animator.current.pose(t, {
      talking: !!props.talking || saying,
      speech: voiced,
      emotion: props.cheering ? 'happy' : props.emotion,
      asleep: props.asleep,
      yawning: props.yawning,
      cheering: props.cheering,
    });
    const pose = props.eyesClosed ? { ...raw, joy: 1 } : raw;
    let look = 0;
    let lookY = 0;
    if (typeof props.look === 'number') {
      look = props.look;
    } else if (props.look === 'cursor' && ref.current && pointer().at > 0) {
      const r = ref.current.getBoundingClientRect();
      ({ look, lookY } = lookTowards(r.left + r.width / 2, r.top + r.height * 0.45, pointer().x, pointer().y));
    } else {
      // Glance around now and then, holding each direction for a moment.
      const phase = seed * 1.7;
      const glance = Math.sin(t * 0.45 + phase) + Math.sin(t * 0.21 + phase * 2) * 0.6;
      look = glance > 0.9 ? 1 : glance < -0.9 ? -1 : 0;
      lookY = Math.sin(t * 0.33 + phase) > 0.85 ? -0.6 : 0;
    }
    setFrame((prev) => ({ pose, look: prev.look + (look - prev.look) * 0.25, lookY: prev.lookY + (lookY - prev.lookY) * 0.25 }));
  });

  useEffect(() => {
    if (reduced) return;
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    let last = 0;
    const untrack = props.look === 'cursor' ? trackPointer() : () => {};
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < 32) return;
      last = now;
      step(now);
    };
    const io = new IntersectionObserver(([entry]) => {
      const next = entry.isIntersecting;
      if (next === visible.current) return;
      visible.current = next;
      if (next) {
        raf = requestAnimationFrame(loop);
        // Came into view with a line nobody heard yet.
        if (!speech.current) say();
      } else {
        cancelAnimationFrame(raf);
      }
    });
    io.observe(el);
    return () => {
      io.disconnect();
      visible.current = false;
      cancelAnimationFrame(raf);
      untrack();
    };
  }, [reduced, props.look]);

  const shown = reduced ? restingFrame(props) : frame;
  return (
    <div ref={ref} className={className} data-talking={props.talking ? 'true' : 'false'}>
      <Avatar style={style} pose={shown.pose} look={shown.look} lookY={shown.lookY} label={label} className="block h-full w-full" />
    </div>
  );
}
