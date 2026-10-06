'use client';

import { segmentAt, type Segment } from '@boringtalks/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Ties an <audio> element to a transcript: which segment is playing, and
 * seeking when a segment is clicked. `segments` must be sorted by start time.
 */
export function useAudioSync(segments: readonly Segment[]) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [currentMs, setCurrentMs] = useState(0);
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);

  const ref = useCallback((el: HTMLAudioElement | null) => {
    audioRef.current = el;
    setAudio(el);
  }, []);

  useEffect(() => {
    if (!audio) return;
    const sync = () => setCurrentMs(Math.round(audio.currentTime * 1000));
    audio.addEventListener('timeupdate', sync);
    audio.addEventListener('seeked', sync);
    return () => {
      audio.removeEventListener('timeupdate', sync);
      audio.removeEventListener('seeked', sync);
    };
  }, [audio]);

  const seek = useCallback((ms: number, play = true) => {
    setCurrentMs(ms);
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = ms / 1000;
    if (play) void el.play().catch(() => {});
  }, []);

  const activeIndex = audio ? segmentAt(segments, currentMs) : -1;
  return { ref, currentMs, activeIndex, seek, hasAudio: !!audio };
}
