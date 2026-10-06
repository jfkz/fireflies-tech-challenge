import type { DayStats } from '@boringtalks/shared';
import { addDays, daysBetween, startOfMonth, startOfWeek, weekday } from './dates';

/** 0 (no meetings) to 4 (a heavy day), by minutes spent in meetings. */
export function intensity(totalSec: number, count = 0): 0 | 1 | 2 | 3 | 4 {
  const min = totalSec / 60;
  if (count === 0 && min === 0) return 0;
  if (min < 30) return 1;
  if (min < 90) return 2;
  if (min < 180) return 3;
  return 4;
}

export interface HeatCell {
  date: string;
  count: number;
  totalSec: number;
  level: 0 | 1 | 2 | 3 | 4;
  /** After `today`: drawn empty. */
  future: boolean;
}

/**
 * GitHub-style year: columns are weeks (Monday first), rows are weekdays,
 * ending with the week of `today`.
 */
export function heatmap(days: readonly DayStats[], today: string, weeks = 53): HeatCell[][] {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const first = addDays(startOfWeek(today), -7 * (weeks - 1));
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const date = addDays(first, w * 7 + d);
      const s = byDate.get(date);
      return { date, count: s?.count ?? 0, totalSec: s?.totalSec ?? 0, level: intensity(s?.totalSec ?? 0, s?.count ?? 0), future: date > today };
    }),
  );
}

/** The cells of a month view: whole weeks, Monday first, with days outside the month marked. */
export function monthGrid(monthKey: string): { date: string; inMonth: boolean }[][] {
  const first = startOfMonth(monthKey);
  const start = addDays(first, -weekday(first));
  const month = first.slice(0, 7);
  const weeks: { date: string; inMonth: boolean }[][] = [];
  for (let w = 0; w < 6; w++) {
    const row = Array.from({ length: 7 }, (_, d) => {
      const date = addDays(start, w * 7 + d);
      return { date, inMonth: date.startsWith(month) };
    });
    if (w > 3 && !row.some((c) => c.inMonth)) break;
    weeks.push(row);
  }
  return weeks;
}

export interface Totals {
  count: number;
  totalSec: number;
}

function sum(days: readonly DayStats[], from: string, to: string): Totals {
  return days.filter((d) => d.date >= from && d.date < to).reduce((t, d) => ({ count: t.count + d.count, totalSec: t.totalSec + d.totalSec }), { count: 0, totalSec: 0 });
}

/** The numbers at the top of the calendar. */
export function summarize(days: readonly DayStats[], today: string) {
  const tomorrow = addDays(today, 1);
  const week = sum(days, startOfWeek(today), tomorrow);
  const month = sum(days, startOfMonth(today), tomorrow);
  const all = sum(days, '0000-01-01', tomorrow);
  const firstDay = days.find((d) => d.date <= today)?.date;
  // Weekly average over the weeks since the first meeting in range (at least one).
  const weeks = firstDay ? Math.max(1, Math.ceil((daysBetween(firstDay, today) + 1) / 7)) : 1;
  const busiest = days.filter((d) => d.date <= today).reduce<DayStats | null>((b, d) => (!b || d.totalSec > b.totalSec ? d : b), null);
  return { week, month, all, perWeek: { count: all.count / weeks, totalSec: all.totalSec / weeks }, busiest };
}
