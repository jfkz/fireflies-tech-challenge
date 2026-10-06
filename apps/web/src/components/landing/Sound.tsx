'use client';

import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { VoiceEngine } from '@/lib/landing/voice';

const STORAGE_KEY = 'bt.sound';

interface SoundState {
  /** The visitor turned sound on. */
  on: boolean;
  toggle: () => void;
  engine: VoiceEngine;
}

const SoundContext = createContext<SoundState | null>(null);

/** Sound settings for the landing page's heads, or null outside the landing page. */
export function useSound(): SoundState | null {
  return use(SoundContext);
}

function readPreference(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

function writePreference(on: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    // Private mode or blocked storage: the choice just isn't remembered.
  }
}

/** Gives the landing page's heads a voice. Muted until the visitor turns it on. */
export function SoundProvider({ children }: { children: ReactNode }) {
  const [engine] = useState(() => new VoiceEngine());
  const [on, setOn] = useState(false);

  // A returning visitor who left sound on: browsers only allow audio after a
  // gesture, so start at the first click or key press.
  useEffect(() => {
    if (!readPreference()) return;
    const start = () => {
      if (engine.unlock()) setOn(true);
    };
    window.addEventListener('pointerdown', start, { once: true });
    window.addEventListener('keydown', start, { once: true });
    return () => {
      window.removeEventListener('pointerdown', start);
      window.removeEventListener('keydown', start);
    };
  }, [engine]);

  const toggle = useCallback(() => {
    const next = !on && engine.unlock();
    if (!next) engine.hush();
    writePreference(next);
    setOn(next);
  }, [on, engine]);

  const value = useMemo(() => ({ on, toggle, engine }), [on, toggle, engine]);
  return <SoundContext value={value}>{children}</SoundContext>;
}

/** The floating mute button. */
export function SoundToggle() {
  const sound = useSound();
  if (!sound) return null;
  const { on, toggle } = sound;
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      aria-label={on ? 'Mute the heads' : 'Let the heads talk out loud'}
      title={on ? 'Sound on' : 'Sound off'}
      data-testid="sound-toggle"
      className="motion-only fixed right-4 bottom-4 z-[60] flex items-center gap-2 rounded-full border-[2.5px] border-ink bg-white px-4 py-2.5 text-sm font-extrabold text-ink shadow-[3px_4px_0_0_var(--color-ink)] transition-transform hover:-translate-y-0.5 active:translate-y-0.5 sm:right-6 sm:bottom-6"
    >
      <SpeakerGlyph on={on} />
      <span>{on ? 'Sound on' : 'Sound off'}</span>
    </button>
  );
}

function SpeakerGlyph({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
      {on ? <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /> : <path d="M17 9l5 6M22 9l-5 6" />}
    </svg>
  );
}
