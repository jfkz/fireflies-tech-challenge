import { resolveDueDate } from './due-date';

// Tuesday, October 6 2026 — the meeting in the bug report.
const tue = new Date('2026-10-06T15:00:00Z');
const due = (text: string, at = tue) => resolveDueDate(text, at);

describe('resolveDueDate', () => {
  it('takes the end of a range or a choice', () => {
    expect(due('today or tomorrow mid-day')).toBe('2026-10-07');
    expect(due('today')).toBe('2026-10-06');
    expect(due('EOD')).toBe('2026-10-06');
    expect(due('Thursday or Friday')).toBe('2026-10-09');
  });

  it('counts weekdays from the meeting day', () => {
    expect(due('Friday')).toBe('2026-10-09');
    expect(due('by Fri')).toBe('2026-10-09');
    expect(due('before Friday')).toBe('2026-10-08');
    expect(due('next Friday')).toBe('2026-10-16');
    expect(due('Tuesday')).toBe('2026-10-13');
    expect(due('Monday', new Date('2026-10-09T09:00:00Z'))).toBe('2026-10-12');
  });

  it('places weeks, weekends, months and quarters on their last day', () => {
    expect(due('weekend')).toBe('2026-10-11');
    expect(due('over the weekend')).toBe('2026-10-11');
    expect(due('next weekend')).toBe('2026-10-18');
    expect(due('this week')).toBe('2026-10-09');
    expect(due('end of next week')).toBe('2026-10-16');
    expect(due('end of month')).toBe('2026-10-31');
    expect(due('next month')).toBe('2026-11-30');
    expect(due('end of quarter')).toBe('2026-12-31');
    expect(due('in 2 weeks')).toBe('2026-10-20');
    expect(due('day after tomorrow')).toBe('2026-10-08');
  });

  it('reads calendar dates, rolling past ones into next year', () => {
    expect(due('Oct 30')).toBe('2026-10-30');
    expect(due('October 30th')).toBe('2026-10-30');
    expect(due('the 20th')).toBe('2026-10-20');
    expect(due('30th of November')).toBe('2026-11-30');
    expect(due('Jan 5')).toBe('2027-01-05');
    expect(due('2026-12-01')).toBe('2026-12-01');
  });

  it('gives up on deadlines that are not dates', () => {
    expect(due('ASAP')).toBeNull();
    expect(due('after the launch')).toBeNull();
    expect(due('')).toBeNull();
    expect(resolveDueDate(null, tue)).toBeNull();
    expect(due('2025-01-01')).toBeNull();
  });
});
