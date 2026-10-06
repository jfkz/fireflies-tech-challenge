import { describe, expect, it } from 'vitest';
import { addDays, addMonths, compactMinutes, dateKey, daysBetween, formatDay, formatMinutes, startOfMonth, startOfWeek, weekday } from './dates';

describe('date keys', () => {
  it('formats an instant as the local calendar date in a time zone', () => {
    const at = new Date('2026-10-06T23:30:00Z');
    expect(dateKey(at, 'UTC')).toBe('2026-10-06');
    expect(dateKey(at, 'Europe/Berlin')).toBe('2026-10-07');
  });

  it('does calendar arithmetic without time zone drift', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
    expect(daysBetween('2026-10-06', '2026-10-09')).toBe(3);
    expect(weekday('2026-10-05')).toBe(0); // Monday
    expect(weekday('2026-10-11')).toBe(6); // Sunday
    expect(startOfWeek('2026-10-11')).toBe('2026-10-05');
    expect(startOfMonth('2026-10-17')).toBe('2026-10-01');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-01');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-01');
  });

  it('labels days and durations for people', () => {
    expect(formatDay('2026-10-09', '2026-10-06')).toBe('Fri, Oct 9');
    expect(formatDay('2027-01-04', '2026-10-06')).toBe('Mon, Jan 4, 2027');
    expect(formatMinutes(0)).toBe('0 min');
    expect(formatMinutes(45 * 60)).toBe('45 min');
    expect(formatMinutes(120 * 60)).toBe('2 h');
    expect(formatMinutes(130 * 60)).toBe('2 h 10 min');
    expect(compactMinutes(45 * 60)).toBe('45m');
    expect(compactMinutes(65 * 60)).toBe('1h05');
    expect(compactMinutes(180 * 60)).toBe('3h');
  });
});
