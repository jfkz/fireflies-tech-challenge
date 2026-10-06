import { describe, expect, it } from 'vitest';
import { applySpeakerNames, formatDuration, formatTimestamp, mergeSegments, segmentAt, speakerName, speakersOf, transcriptText } from './format';

const seg = (speaker: string, startMs: number, endMs: number, text: string) => ({ speaker, startMs, endMs, text });

describe('formatTimestamp', () => {
  it.each([
    [0, '0:00'],
    [9_400, '0:09'],
    [247_000, '4:07'],
    [3_909_000, '1:05:09'],
    [-5, '0:00'],
  ])('%i ms → %s', (ms, out) => expect(formatTimestamp(ms)).toBe(out));
});

describe('formatDuration', () => {
  it.each([
    [null, '—'],
    [undefined, '—'],
    [30, 'under a minute'],
    [42 * 60, '42 min'],
    [3600, '1 h'],
    [3900, '1 h 5 min'],
  ])('%s s → %s', (sec, out) => expect(formatDuration(sec)).toBe(out));
});

describe('mergeSegments', () => {
  it('orders both channels by time and joins close phrases of one speaker', () => {
    const merged = mergeSegments([
      seg('Speaker 1', 3000, 4000, 'and the budget.'),
      seg('You', 0, 1000, 'Hi all,'),
      seg('You', 1500, 2500, "let's start."),
      seg('Speaker 1', 6000, 7000, 'Next point.'),
    ]);
    expect(merged).toEqual([
      seg('You', 0, 2500, "Hi all, let's start."),
      seg('Speaker 1', 3000, 4000, 'and the budget.'),
      seg('Speaker 1', 6000, 7000, 'Next point.'),
    ]);
  });
  it('does not change its input', () => {
    const input = [seg('A', 0, 1, 'x'), seg('A', 2, 3, 'y')];
    mergeSegments(input);
    expect(input).toHaveLength(2);
  });
});

describe('transcript helpers', () => {
  const segments = [seg('You', 0, 900, 'Hello'), seg('Speaker 1', 1000, 2000, 'Hi'), seg('You', 65_000, 66_000, 'Bye')];
  it('lists speakers in order of appearance', () => {
    expect(speakersOf(segments)).toEqual(['You', 'Speaker 1']);
  });
  it('renders a timestamped transcript', () => {
    expect(transcriptText(segments)).toBe('[0:00] You: Hello\n[0:01] Speaker 1: Hi\n[1:05] You: Bye');
  });
  it('finds the segment playing at a time', () => {
    expect(segmentAt(segments, 500)).toBe(0);
    expect(segmentAt(segments, 1500)).toBe(1);
    expect(segmentAt(segments, 70_000)).toBe(2);
    expect(segmentAt([], 10)).toBe(-1);
    expect(segmentAt([seg('A', 100, 200, 'x')], 50)).toBe(-1);
  });
});

describe('speaker names', () => {
  const segs = [
    { speaker: 'You', startMs: 0, endMs: 1, text: 'a' },
    { speaker: 'Speaker 1', startMs: 1, endMs: 2, text: 'b' },
    { speaker: 'Speaker 2', startMs: 2, endMs: 3, text: 'c' },
  ];
  it('replaces labels that have a name and keeps the rest', () => {
    expect(applySpeakerNames(segs, { You: 'Mike', 'Speaker 1': 'Maya' }).map((s) => s.speaker)).toEqual(['Mike', 'Maya', 'Speaker 2']);
  });
  it('does not treat object prototype keys as names', () => {
    expect(speakerName('constructor', {})).toBe('constructor');
  });
});
