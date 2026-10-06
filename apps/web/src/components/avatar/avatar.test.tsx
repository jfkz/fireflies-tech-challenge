import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stillPose } from '@/lib/avatar/pose';
import { MEN, TALKER, WOMEN } from '@/lib/avatar/styles';
import { Avatar, eyesState } from './Avatar';
import { SpeechBubble } from './SpeechBubble';
import { restingFrame, TalkingHead } from './TalkingHead';
import { TypeLine, typedLength } from './TypeLine';

function reducedMotion(on: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (q) => ({ matches: on, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as MediaQueryList,
  );
}

afterEach(() => vi.useRealTimers());

describe('Avatar', () => {
  it('draws a closed mouth and open eyes at rest', () => {
    const { container } = render(<Avatar style={MEN[0]} />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('data-mouth', 'closed');
    expect(svg).toHaveAttribute('data-eyes', 'open');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('[data-part="closed"]')).not.toBeNull();
  });

  it('opens the mouth per syllable and shows teeth when wide', () => {
    const { container, rerender } = render(<Avatar style={TALKER} pose={stillPose({ mouth: 0.3 })} />);
    expect(container.querySelector('svg')).toHaveAttribute('data-mouth', 'open');
    expect(container.querySelector('[data-part="talking"] rect')).toBeNull();
    rerender(<Avatar style={TALKER} pose={stillPose({ mouth: 0.8 })} />);
    expect(container.querySelector('[data-part="talking"] rect')).not.toBeNull();
  });

  it('shuts the eyes mid-blink, asleep, or in a happy arc', () => {
    expect(eyesState(stillPose({ blink: 1 }))).toBe('shut');
    expect(eyesState(stillPose({ sleep: 1 }))).toBe('shut');
    expect(eyesState(stillPose({ joy: 1 }))).toBe('joy');
    expect(eyesState(stillPose({ yawn: 1 }))).toBe('shut');
    expect(eyesState(stillPose())).toBe('open');
  });

  it('snores with Zzz when asleep and yawns with a big mouth', () => {
    const { container, rerender } = render(<Avatar style={WOMEN[0]} pose={stillPose({ sleep: 1, time: 1.3 })} />);
    expect(container.querySelectorAll('[data-part="zzz"]')).toHaveLength(3);
    expect(container.querySelector('[data-part="snore"]')).not.toBeNull();
    rerender(<Avatar style={WOMEN[0]} pose={stillPose({ yawn: 1 })} />);
    expect(container.querySelector('[data-part="yawn"]')).not.toBeNull();
  });

  it('draws every hair cut, beards and emotion marks', () => {
    for (const style of [...MEN, ...WOMEN, TALKER]) {
      for (const emotion of ['happy', 'sad', 'angry', 'scared', 'surprised', 'disgusted'] as const) {
        const { container, unmount } = render(<Avatar style={style} pose={stillPose({ emotion, time: 0.4 })} look={1} lookY={1} />);
        expect(container.querySelector('svg')).not.toBeNull();
        unmount();
      }
    }
  });

  it('is an image with a name when labelled', () => {
    render(<Avatar style={MEN[1]} label="A sleepy colleague" />);
    expect(screen.getByRole('img', { name: 'A sleepy colleague' })).toBeInTheDocument();
  });
});

describe('TalkingHead', () => {
  it('holds a still pose with reduced motion and never starts an animation loop', () => {
    reducedMotion(true);
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    const { container } = render(<TalkingHead style={MEN[0]} talking asleep />);
    expect(raf).not.toHaveBeenCalled();
    expect(container.querySelector('svg')).toHaveAttribute('data-eyes', 'shut');
    expect(container.querySelector('svg')).toHaveAttribute('data-mouth', 'closed');
  });

  it('animates while on screen', async () => {
    reducedMotion(false);
    let frame: FrameRequestCallback | null = null;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => ((frame = cb), 1));
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    const { container, unmount } = render(<TalkingHead style={MEN[0]} talking look="cursor" />);
    expect(frame).not.toBeNull();
    // Run a few seconds of frames: the mouth opens at some point.
    let opened = false;
    for (let t = 100; t < 4000 && !opened; t += 40) {
      act(() => frame!(t));
      opened = container.querySelector('svg')!.getAttribute('data-mouth') === 'open';
    }
    expect(opened).toBe(true);
    expect(container.firstElementChild).toHaveAttribute('data-talking', 'true');
    unmount();
  });

  it('resting frames reflect the requested state', () => {
    expect(restingFrame({ cheering: true }).pose.joy).toBe(1);
    expect(restingFrame({ eyesClosed: true }).pose.joy).toBe(1);
    expect(restingFrame({ asleep: true, yawning: true }).pose).toMatchObject({ sleep: 1, yawn: 0 });
    expect(restingFrame({ look: -1 }).look).toBe(-1);
  });
});

describe('TypeLine', () => {
  it('computes how much has been typed', () => {
    expect(typedLength('hello', 0)).toBe(0);
    expect(typedLength('hello', 100, 20)).toBe(2);
    expect(typedLength('hello', 10_000)).toBe(5);
  });

  it('shows the whole line at once with reduced motion', () => {
    reducedMotion(true);
    const { container } = render(<TypeLine text="You’re on mute." />);
    expect(container.querySelector('[aria-hidden]')!.firstChild!.textContent).toBe('You’re on mute.');
    expect(screen.getByText('You’re on mute.', { selector: '.sr-only' })).toBeInTheDocument();
  });

  it('types the line out and reports when done', () => {
    reducedMotion(false);
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => (frames.push(cb), frames.length));
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const onDone = vi.fn();
    const { container } = render(<TypeLine text="Hi there" charsPerSec={10} onDone={onDone} />);
    act(() => frames.shift()!(300));
    expect(container.querySelector('[aria-hidden]')!.firstChild!.textContent).toBe('Hi ');
    act(() => frames.shift()!(5000));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('shows nothing until told to play', () => {
    reducedMotion(false);
    const { container } = render(<TypeLine text="Later" play={false} />);
    // All of it is still in the (invisible) remainder, which keeps the bubble's size.
    expect(container.querySelector('[aria-hidden] .opacity-0')!.textContent).toBe('Later');
  });
});

describe('SpeechBubble', () => {
  it('renders the line with a tail on either side, or none', () => {
    const { container, rerender } = render(<SpeechBubble>Let’s take this offline.</SpeechBubble>);
    expect(screen.getByText('Let’s take this offline.')).toBeInTheDocument();
    expect(container.querySelector('svg')).not.toBeNull();
    rerender(<SpeechBubble side="right">x</SpeechBubble>);
    expect(container.querySelector('svg')!.getAttribute('style')).toContain('scaleX(-1)');
    rerender(<SpeechBubble tail={false} marker="#f00">x</SpeechBubble>);
    expect(container.querySelector('svg')).toBeNull();
  });
});
