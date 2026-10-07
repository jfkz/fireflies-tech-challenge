import { daysBetween, formatDay, todayKey, dateKey } from './dates';

/** Labels the recorders make up, mirroring the API: these aren't people, so they have no person page. */
const PLACEHOLDER = /^(you|others|speaker\s*\d+|unknown( speaker)?)$/i;

/**
 * Whether a speaker name is a person with a page of their own: not a made-up label like
 * "Speaker 2" or "Others", and not the account holder ("You" is renamed to their first name).
 */
export function isPersonName(name: string, ownerName?: string | null): boolean {
  const n = name.trim().toLocaleLowerCase();
  if (!n || PLACEHOLDER.test(n)) return false;
  const owner = ownerName?.trim().toLocaleLowerCase();
  return !owner || (n !== owner && n !== owner.split(/\s+/)[0]);
}

/** "/people/Maya%20Chen" */
export function personHref(name: string): string {
  return `/people/${encodeURIComponent(name)}`;
}

/** A route param back to a name; tolerates params that arrive already decoded. */
export function nameFromParam(param: string): string {
  try {
    return decodeURIComponent(param);
  } catch {
    return param;
  }
}

/** How much of the time together they did the talking, 0–100. */
export function talkShare(talkSec: number, togetherSec: number): number {
  return togetherSec > 0 ? Math.round(Math.min(1, talkSec / togetherSec) * 100) : 0;
}

/** The periods the people page can show; `null` is all time. */
export const PERIODS = [
  { days: 30, label: '30 days', param: '30' },
  { days: 90, label: '90 days', param: '90' },
  { days: null, label: 'All time', param: 'all' },
] as const;

export type PeriodDays = (typeof PERIODS)[number]['days'];

/** `?days=` → the period; anything unknown falls back to the last 30 days. */
export function periodFromParam(param: string | null): PeriodDays {
  const period = PERIODS.find((p) => p.param === param);
  return period ? period.days : 30;
}

/** The URL for a period: the default (30 days) keeps the URL bare. */
export function peopleHref(days: PeriodDays): string {
  if (days === 30) return '/people';
  return `/people?days=${PERIODS.find((p) => p.days === days)?.param ?? 'all'}`;
}

/** "today", "yesterday", "5 days ago", "3 weeks ago", else the date: when you last met. */
export function lastMetLabel(iso: string, now: Date = new Date()): string {
  const today = todayKey(now);
  const day = dateKey(new Date(iso));
  const ago = daysBetween(day, today);
  if (ago <= 0) return 'today';
  if (ago === 1) return 'yesterday';
  if (ago < 14) return `${ago} days ago`;
  if (ago < 60) return `${Math.floor(ago / 7)} weeks ago`;
  return formatDay(day, today, { month: 'short', day: 'numeric' });
}
