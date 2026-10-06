import type { Segment } from '@boringtalks/shared';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAudioSync } from './useAudioSync';
import { useDebouncedValue } from './useDebouncedValue';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

afterEach(() => vi.useRealTimers());

describe('useDebouncedValue', () => {
  it('only updates after the value settles', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 300), { initialProps: { v: 'a' } });
    rerender({ v: 'ab' });
    act(() => vi.advanceTimersByTime(200));
    rerender({ v: 'abc' });
    act(() => vi.advanceTimersByTime(200));
    expect(result.current).toBe('a');
    act(() => vi.advanceTimersByTime(100));
    expect(result.current).toBe('abc');
  });
});

describe('usePrefersReducedMotion', () => {
  it('follows the media query', () => {
    const spy = vi.spyOn(window, 'matchMedia').mockImplementation(
      (q) => ({ matches: true, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as MediaQueryList,
    );
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(true);
    expect(spy).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
  });
});

const SEGMENTS: Segment[] = [
  { speaker: 'You', startMs: 0, endMs: 4000, text: 'one' },
  { speaker: 'Speaker 1', startMs: 5000, endMs: 9000, text: 'two' },
  { speaker: 'You', startMs: 10_000, endMs: 15_000, text: 'three' },
];

function Player({ withAudio = true }: { withAudio?: boolean }) {
  const { ref, activeIndex, seek, currentMs } = useAudioSync(SEGMENTS);
  return (
    <div>
      {withAudio && <audio ref={ref} data-testid="audio" />}
      <p data-testid="active">{activeIndex}</p>
      <p data-testid="ms">{currentMs}</p>
      {SEGMENTS.map((s) => (
        <button key={s.startMs} onClick={() => seek(s.startMs)}>
          {s.text}
        </button>
      ))}
    </div>
  );
}

describe('useAudioSync', () => {
  function setTime(audio: HTMLAudioElement, sec: number) {
    Object.defineProperty(audio, 'currentTime', { configurable: true, writable: true, value: sec });
  }

  it('highlights the segment the audio is in', () => {
    render(<Player />);
    const audio = screen.getByTestId('audio') as HTMLAudioElement;
    setTime(audio, 6.2);
    fireEvent.timeUpdate(audio);
    expect(screen.getByTestId('active')).toHaveTextContent('1');
    setTime(audio, 12);
    fireEvent(audio, new Event('seeked'));
    expect(screen.getByTestId('active')).toHaveTextContent('2');
  });

  it('seeks and plays when a segment is clicked', () => {
    render(<Player />);
    const audio = screen.getByTestId('audio') as HTMLAudioElement;
    setTime(audio, 0);
    fireEvent.click(screen.getByText('three'));
    expect(audio.currentTime).toBe(10);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    expect(screen.getByTestId('active')).toHaveTextContent('2');
  });

  it('highlights nothing without audio', () => {
    render(<Player withAudio={false} />);
    fireEvent.click(screen.getByText('two'));
    expect(screen.getByTestId('ms')).toHaveTextContent('5000');
    expect(screen.getByTestId('active')).toHaveTextContent('-1');
  });
});
