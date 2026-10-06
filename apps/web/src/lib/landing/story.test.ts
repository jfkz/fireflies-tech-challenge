import { describe, expect, it } from 'vitest';
import { CHATTER, clockMinutes, howStepAt, MEETING_BEATS, meetingBeatAt } from './story';

describe('landing story', () => {
  it('maps scroll progress to beats', () => {
    expect(meetingBeatAt(0).index).toBe(0);
    expect(meetingBeatAt(0.2).caption).toMatch(/^Minute 12\./);
    expect(meetingBeatAt(0.4).caption).toMatch(/^Minute 31\./);
    expect(meetingBeatAt(0.55).caption).toMatch(/^Minute 47\./);
    expect(meetingBeatAt(0.9).statement).toBe(true);
    expect(meetingBeatAt(1)).toBe(MEETING_BEATS.at(-1));
  });
  it('keeps the clock in step with the captions', () => {
    expect(clockMinutes(0)).toBe(5);
    expect(clockMinutes(0.17)).toBe(12);
    expect(clockMinutes(0.34)).toBe(31);
    expect(clockMinutes(0.5)).toBe(47);
    expect(clockMinutes(1)).toBe(58);
    expect(clockMinutes(-1)).toBe(5);
    for (let p = 0; p < 1; p += 0.05) expect(clockMinutes(p + 0.05)).toBeGreaterThanOrEqual(clockMinutes(p));
  });
  it('heads fall asleep as the meeting drags on', () => {
    const asleep = MEETING_BEATS.map((b) => b.heads.filter((h) => h === 'asleep').length);
    expect(asleep[0]).toBe(0);
    expect(asleep.at(-1)).toBe(3);
  });
  it('has three how-it-works steps', () => {
    expect([0, 0.3, 0.4, 0.7, 1].map(howStepAt)).toEqual([0, 0, 1, 2, 2]);
  });
  it('lets every seat speak in the hero', () => {
    expect(new Set(CHATTER.map(([head]) => head))).toEqual(new Set([0, 1, 2, 3]));
  });
});
