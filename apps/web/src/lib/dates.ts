/** Calendar-day helpers on "YYYY-MM-DD" strings, so tasks and the calendar never drift across time zones. */

/** Today's date where the viewer is, "2026-10-06". */
export function todayKey(now: Date = new Date(), timeZone?: string): string {
  return dateKey(now, timeZone);
}

/** The calendar date of an instant in a time zone (the viewer's by default). */
export function dateKey(at: Date, timeZone?: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/** "2026-10-06" + 3 → "2026-10-09". */
export function addDays(key: string, days: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** 0 = Monday … 6 = Sunday. */
export function weekday(key: string): number {
  return (new Date(`${key}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/** The Monday of the week `key` is in. */
export function startOfWeek(key: string): string {
  return addDays(key, -weekday(key));
}

/** "2026-10" → "2026-10-01". */
export function startOfMonth(key: string): string {
  return `${key.slice(0, 7)}-01`;
}

/** First day of the month `months` after `key`'s month (negative goes back). */
export function addMonths(key: string, months: number): string {
  const d = new Date(`${startOfMonth(key)}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** "Thu, Oct 9" (with the year when it isn't `today`'s). */
export function formatDay(key: string, today?: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }): string {
  const sameYear = !today || key.slice(0, 4) === today.slice(0, 4);
  return new Date(`${key}T12:00:00Z`).toLocaleDateString('en-US', { ...opts, year: sameYear ? undefined : 'numeric', timeZone: 'UTC' });
}

/** "45 min", "2 h 10 min", "0 min". */
export function formatMinutes(totalSec: number): string {
  const min = Math.round(totalSec / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** "45m", "1h15", "3h": for tight spaces like a calendar cell. */
export function compactMinutes(totalSec: number): string {
  const min = Math.round(totalSec / 60);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}
