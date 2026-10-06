'use client';

import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { SpeechBubble } from '@/components/avatar/SpeechBubble';
import { TalkingHead } from '@/components/avatar/TalkingHead';
import { LISTENER } from '@/lib/avatar/styles';

export type AuthMood = 'asleep' | 'awake' | 'shy' | 'oops' | 'yay';

interface MoodContext {
  mood: AuthMood;
  poke(mood: AuthMood): void;
}

const Ctx = createContext<MoodContext>({ mood: 'asleep', poke: () => {} });

/** Nodding off again after this long without typing. */
export const DOZE_AFTER_MS = 9000;

export function AuthMoodProvider({ children }: { children: ReactNode }) {
  const [mood, setMood] = useState<AuthMood>('asleep');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const poke = useCallback((next: AuthMood) => {
    setMood(next);
    clearTimeout(timer.current);
    if (next === 'awake' || next === 'shy') timer.current = setTimeout(() => setMood('asleep'), DOZE_AFTER_MS);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  const value = useMemo(() => ({ mood, poke }), [mood, poke]);
  return <Ctx value={value}>{children}</Ctx>;
}

export function useAuthMood() {
  return use(Ctx);
}

const LINES: Record<AuthMood, string | null> = {
  asleep: null,
  awake: 'Oh! Hi. Go on, I’m listening.',
  shy: 'I’m not looking. Promise.',
  oops: 'Hmm. That didn’t work.',
  yay: 'You’re in!',
};

/** The receptionist: asleep at the desk until you start typing. */
export function SleepyHead() {
  const { mood } = useAuthMood();
  const line = LINES[mood];
  return (
    <div className="relative mx-auto w-[min(56vw,380px)]" data-mood={mood}>
      <div className="absolute bottom-[86%] left-[46%] z-10 min-h-12 w-max max-w-[min(58vw,280px)]" aria-live="polite">
        {line && <SpeechBubble>{line}</SpeechBubble>}
      </div>
      <TalkingHead
        style={LISTENER}
        asleep={mood === 'asleep'}
        eyesClosed={mood === 'shy'}
        cheering={mood === 'yay'}
        emotion={mood === 'oops' ? 'sad' : mood === 'shy' ? 'happy' : undefined}
        talking={mood === 'awake'}
        look={mood === 'shy' ? 1 : 'cursor'}
        seed={11}
        className="aspect-square w-full"
      />
      {mood === 'asleep' && <p className="mt-2 text-center text-sm font-extrabold text-white/80">It wakes up when you type.</p>}
    </div>
  );
}
