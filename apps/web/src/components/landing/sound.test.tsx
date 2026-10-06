import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TalkingHead } from '@/components/avatar/TalkingHead';
import { TALKER } from '@/lib/avatar/styles';
import { VoiceEngine } from '@/lib/landing/voice';
import { FakeAudioContext, installFakeAudio } from '@/test/fakeAudio';
import { Faq } from './Faq';
import { SoundProvider, SoundToggle, useSound } from './Sound';

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('SoundToggle', () => {
  it('starts muted, turns sound on and off, and remembers the choice', async () => {
    installFakeAudio();
    render(
      <SoundProvider>
        <SoundToggle />
      </SoundProvider>,
    );
    const button = screen.getByTestId('sound-toggle');
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).toHaveTextContent('Sound off');

    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem('bt.sound')).toBe('on');
    expect(FakeAudioContext.instances).toHaveLength(1);

    await userEvent.click(button);
    expect(button).toHaveTextContent('Sound off');
    expect(localStorage.getItem('bt.sound')).toBe('off');
  });

  it('stays off when the browser has no Web Audio', async () => {
    render(
      <SoundProvider>
        <SoundToggle />
      </SoundProvider>,
    );
    await userEvent.click(screen.getByTestId('sound-toggle'));
    expect(screen.getByTestId('sound-toggle')).toHaveAttribute('aria-pressed', 'false');
  });

  it('turns back on at the first click for a visitor who left it on', async () => {
    installFakeAudio();
    localStorage.setItem('bt.sound', 'on');
    render(
      <SoundProvider>
        <SoundToggle />
      </SoundProvider>,
    );
    expect(screen.getByTestId('sound-toggle')).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(document.body);
    expect(screen.getByTestId('sound-toggle')).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders nothing outside the landing page', () => {
    const { container } = render(<SoundToggle />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('TalkingHead voice', () => {
  it('says each new line out loud when sound is on', async () => {
    installFakeAudio();
    const speak = vi.spyOn(VoiceEngine.prototype, 'speak');
    function Turn({ line }: { line: string }) {
      const sound = useSound()!;
      return (
        <>
          <button onClick={sound.toggle}>toggle</button>
          <TalkingHead style={TALKER} talking line={line} />
        </>
      );
    }
    const { rerender } = render(
      <SoundProvider>
        <Turn line="Can everyone see my screen?" />
      </SoundProvider>,
    );
    // Muted: the line is "said" silently, nothing is scheduled.
    expect(speak).toHaveBeenCalledTimes(0);
    await userEvent.click(screen.getByText('toggle'));
    await act(async () => {});
    rerender(
      <SoundProvider>
        <Turn line="We can see your tabs." />
      </SoundProvider>,
    );
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak.mock.calls[0][0].length).toBe('Wecanseeyourtabs'.length);
  });

  it('repeats a line on a timer', () => {
    vi.useFakeTimers();
    installFakeAudio();
    const speak = vi.spyOn(VoiceEngine.prototype, 'speak');
    function On() {
      const sound = useSound()!;
      return <button onClick={sound.toggle}>on</button>;
    }
    render(
      <SoundProvider>
        <On />
        <TalkingHead style={TALKER} talking line="Hello" repeatEvery={1000} />
      </SoundProvider>,
    );
    act(() => screen.getByText('on').click());
    act(() => vi.advanceTimersByTime(2100));
    expect(speak.mock.calls.length).toBeGreaterThanOrEqual(2);
    vi.useRealTimers();
  });
});

describe('Faq', () => {
  it('lists every question as an expandable answer', () => {
    render(<Faq />);
    expect(screen.getByRole('heading', { name: /Questions/ })).toBeInTheDocument();
    expect(screen.getByText('Does a bot join my call?').closest('details')).not.toBeNull();
  });
});
