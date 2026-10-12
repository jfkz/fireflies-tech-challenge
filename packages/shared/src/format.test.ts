import { describe, expect, it } from 'vitest';
import { applySpeakerNames, formatDuration, formatTimestamp, mergeSegments, segmentAt, splitLongSegments, speakerName, speakersOf, transcriptText } from './format';

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

describe('splitLongSegments', () => {
  it('leaves short lines alone', () => {
    const s = [{ speaker: 'A', startMs: 0, endMs: 10, text: 'Hi.' }];
    expect(splitLongSegments(s)).toEqual(s);
  });

  it('cuts a long line at sentence ends and shares out its time', () => {
    const sentence = 'Мы обсудили условия контракта. ';
    const text = sentence.repeat(1000).trim();
    const pieces = splitLongSegments([{ speaker: 'Speaker 2', startMs: 1_000, endMs: 601_000, text }]);
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.every((p) => p.text.length <= 10_000 && p.text.endsWith('.') && p.speaker === 'Speaker 2')).toBe(true);
    expect(pieces.map((p) => p.text).join(' ')).toBe(text);
    expect(pieces[0].startMs).toBe(1_000);
    expect(pieces.at(-1)!.endMs).toBe(601_000);
    for (let i = 1; i < pieces.length; i++) expect(pieces[i].startMs).toBe(pieces[i - 1].endMs);
  });

  it('falls back to a space, then to a hard cut', () => {
    expect(splitLongSegments([{ speaker: 'A', startMs: 0, endMs: 0, text: 'word '.repeat(30).trim() }], 40).every((p) => p.text.length <= 40 && !p.text.includes('wor ')))
      .toBe(true);
    expect(splitLongSegments([{ speaker: 'A', startMs: 0, endMs: 100, text: 'x'.repeat(25) }], 10).map((p) => p.text.length)).toEqual([10, 10, 5]);
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
