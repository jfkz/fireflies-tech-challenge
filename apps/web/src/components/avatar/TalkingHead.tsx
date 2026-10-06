'use client';

import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { Emotion } from '@/lib/avatar/face';
import { PoseAnimator, stillPose, type Pose } from '@/lib/avatar/pose';
import type { AvatarStyle } from '@/lib/avatar/styles';
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

  const step = useEffectEvent((now: number) => {
    animator.current ??= new PoseAnimator(seed);
    const t = now / 1000;
    const raw = animator.current.pose(t, {
      talking: !!props.talking,
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
    let visible = false;
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
      if (next === visible) return;
      visible = next;
      if (visible) raf = requestAnimationFrame(loop);
      else cancelAnimationFrame(raf);
    });
    io.observe(el);
    return () => {
      io.disconnect();
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
