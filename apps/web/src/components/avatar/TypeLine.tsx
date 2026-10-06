'use client';

import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';
import { useEffect, useState } from 'react';

/** How many characters of `text` show `elapsedMs` after typing started. */
export function typedLength(text: string, elapsedMs: number, charsPerSec = 32): number {
  return Math.max(0, Math.min(text.length, Math.floor((elapsedMs / 1000) * charsPerSec)));
}

/**
 * Types `text` out like live captions arriving. Screen readers get the whole
 * line at once; with reduced motion everyone does.
 */
export function TypeLine({ text, play = true, charsPerSec = 32, onDone }: { text: string; play?: boolean; charsPerSec?: number; onDone?: () => void }) {
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (reduced || !play) return;
    const started = performance.now();
    let raf = 0;
    let finished = false;
    const tick = (now: number) => {
      const n = typedLength(text, now - started, charsPerSec);
      setShown(n);
      if (n >= text.length) {
        if (!finished) {
          finished = true;
          onDone?.();
        }
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // onDone is intentionally not a dependency: a new callback must not restart typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, play, reduced, charsPerSec]);

  const visible = reduced ? text.length : play ? shown : 0;
  return (
    <span>
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {text.slice(0, visible)}
        <span className="opacity-0">{text.slice(visible)}</span>
      </span>
    </span>
  );
}
