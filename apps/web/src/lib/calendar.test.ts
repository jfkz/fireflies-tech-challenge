import { describe, expect, it } from 'vitest';
import { heatmap, intensity, monthGrid, summarize } from './calendar';

describe('calendar', () => {
  it('shades days by minutes in meetings', () => {
    expect(intensity(0, 0)).toBe(0);
    expect(intensity(0, 1)).toBe(1);
    expect(intensity(29 * 60, 1)).toBe(1);
    expect(intensity(60 * 60, 2)).toBe(2);
    expect(intensity(2 * 3600, 3)).toBe(3);
    expect(intensity(4 * 3600, 5)).toBe(4);
  });

  it('lays out a year of weeks ending with this week, Monday first', () => {
    const weeks = heatmap([{ date: '2026-10-06', count: 2, totalSec: 5400 }], '2026-10-07');
    expect(weeks).toHaveLength(53);
    const last = weeks.at(-1)!;
    expect(last[0].date).toBe('2026-10-05');
    expect(last[1]).toMatchObject({ date: '2026-10-06', count: 2, level: 3, future: false });
    expect(last[3].future).toBe(true);
    expect(weeks[0][0].date).toBe('2025-10-06');
  });

  it('builds whole weeks around a month', () => {
    const grid = monthGrid('2026-10-15');
    expect(grid[0][0]).toEqual({ date: '2026-09-28', inMonth: false });
    expect(grid[0][3]).toEqual({ date: '2026-10-01', inMonth: true });
    expect(grid.at(-1)!.at(-1)!.date).toBe('2026-11-01');
    expect(grid).toHaveLength(5);
  });

  it('adds up this week, this month, a weekly average and the busiest day', () => {
    const days = [
      { date: '2026-09-15', count: 1, totalSec: 1800 },
      { date: '2026-10-01', count: 2, totalSec: 3600 },
      { date: '2026-10-06', count: 3, totalSec: 7200 },
      { date: '2026-10-09', count: 1, totalSec: 600 }, // future: ignored
    ];
    const s = summarize(days, '2026-10-07');
    expect(s.week).toEqual({ count: 3, totalSec: 7200 });
    expect(s.month).toEqual({ count: 5, totalSec: 10800 });
    expect(s.all).toEqual({ count: 6, totalSec: 12600 });
    expect(s.busiest?.date).toBe('2026-10-06');
    // Sep 15 → Oct 7 is 23 days: 4 weeks.
    expect(s.perWeek).toEqual({ count: 1.5, totalSec: 3150 });
    expect(summarize([], '2026-10-07').busiest).toBeNull();
  });
});
