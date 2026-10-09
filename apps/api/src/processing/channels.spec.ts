import { seg } from '../testing/fixtures';
import { isEcho, mergeChannels } from './channels';

describe('mergeChannels', () => {
  it('labels the microphone "You" and interleaves both sides by time', () => {
    const mic = [seg('Speaker 1', 0, 1000, 'Hi everyone'), seg('Speaker 2', 5000, 6000, 'Sounds good to me')];
    const system = [seg('Speaker 1', 2000, 4000, 'Morning, shall we start?'), seg('Speaker 2', 7000, 8000, 'Great')];
    expect(mergeChannels(mic, system)).toEqual([
      seg('You', 0, 1000, 'Hi everyone'),
      seg('Speaker 1', 2000, 4000, 'Morning, shall we start?'),
      seg('You', 5000, 6000, 'Sounds good to me'),
      seg('Speaker 2', 7000, 8000, 'Great'),
    ]);
  });

  it('drops what the microphone heard from the speakers', () => {
    const system = [seg('Speaker 1', 10_000, 14_000, 'The release moves to Friday afternoon')];
    const mic = [seg('Speaker 1', 10_400, 14_200, 'release moves to Friday afternoon'), seg('Speaker 1', 15_000, 16_000, 'Okay, fine')];
    expect(mergeChannels(mic, system)).toEqual([system[0], seg('You', 15_000, 16_000, 'Okay, fine')]);
  });

  it('works with one side silent', () => {
    expect(mergeChannels([], [seg('Speaker 1', 0, 1, 'hi')])).toEqual([seg('Speaker 1', 0, 1, 'hi')]);
    expect(mergeChannels([seg('Speaker 1', 0, 1, 'hi')], [])).toEqual([seg('You', 0, 1, 'hi')]);
  });

  it('puts the other side first when both start together', () => {
    const merged = mergeChannels([seg('Speaker 1', 0, 1000, 'yes')], [seg('Speaker 1', 0, 1000, 'no')]);
    expect(merged.map((s) => s.speaker)).toEqual(['Speaker 1', 'You']);
  });
});

describe('isEcho', () => {
  it('needs the same time and mostly the same words', () => {
    const system = [seg('Speaker 1', 0, 2000, 'Ship it on Friday')];
    expect(isEcho(seg('x', 500, 2500, 'ship it on friday'), system)).toBe(true);
    expect(isEcho(seg('x', 5000, 6000, 'ship it on friday'), system)).toBe(false);
    expect(isEcho(seg('x', 500, 2500, 'no, Monday is better for me'), system)).toBe(false);
    expect(isEcho(seg('x', 500, 2500, '…'), system)).toBe(false);
    expect(isEcho(seg('x', 500, 2500, 'Привет всем'), [seg('S', 0, 2000, 'привет всем')])).toBe(true);
  });
});
