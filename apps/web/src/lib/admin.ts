import type { AdminDay, DevicePlatform, MeetingSource, MeetingStatus } from '@boringtalks/shared';

/** What the daily chart plots. */
export type DailyMetric = 'meetings' | 'hours' | 'signups';

export const DAILY_METRICS: { key: DailyMetric; label: string; unit: (n: number) => string }[] = [
  { key: 'meetings', label: 'Meetings', unit: (n) => (n === 1 ? 'meeting' : 'meetings') },
  { key: 'hours', label: 'Hours recorded', unit: (n) => (n === 1 ? 'hour' : 'hours') },
  { key: 'signups', label: 'Sign-ups', unit: (n) => (n === 1 ? 'sign-up' : 'sign-ups') },
];

export const valueOf = (day: AdminDay, metric: DailyMetric): number => day[metric];

/** The top of the y-axis: the max rounded up to 1, 2, 2.5 or 5 × a power of ten (at least 1). */
export function niceMax(max: number): number {
  if (!(max > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * power >= max)!;
  return Math.max(1, step * power);
}

/** 1,284 / 12.9K / 3.4M. */
export function compact(n: number): string {
  return new Intl.NumberFormat('en', { notation: n >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: n >= 10_000 || n < 10 ? 1 : 0 }).format(n);
}

/** $0.38, $12, $1.2K. */
export function usd(n: number): string {
  if (n >= 1000) return `$${compact(n)}`;
  return `$${n.toFixed(n >= 100 ? 0 : 2)}`;
}

/** "6%", "3.3%" (one decimal only below 10% and only when it isn't whole), "—" for none. */
export function percent(rate: number | null): string {
  if (rate === null) return '—';
  const value = rate * 100;
  return `${value < 10 && Math.abs(value - Math.round(value)) >= 0.05 ? value.toFixed(1) : Math.round(value)}%`;
}

export const SOURCE_LABELS: Record<MeetingSource, string> = {
  macos: 'Mac app',
  windows: 'Windows app',
  browser: 'Browser recorder',
  upload: 'Uploaded files',
  demo: 'Demo',
};

export const STATUS_LABELS: Record<MeetingStatus, string> = {
  recording: 'Recording',
  uploaded: 'Uploaded',
  transcribing: 'Transcribing',
  summarizing: 'Summarizing',
  ready: 'Ready',
  failed: 'Failed',
};

export const PLATFORM_LABELS: Record<DevicePlatform, string> = { macos: 'Mac', windows: 'Windows' };

/** "Mac 0.5.0", "Windows (version not seen yet)". */
export function appLabel(platform: DevicePlatform | null, version: string | null): string {
  const name = platform ? PLATFORM_LABELS[platform] : 'Unknown app';
  return version ? `${name} ${version}` : `${name} (version not seen yet)`;
}

/** "2 h 10 min", "45 min". */
export function minutes(total: number): string {
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** A recording limit as admins pick it: null = the default, 0 = none. */
export function limitLabel(limit: number | null, effective?: number | null): string {
  if (limit === null) return effective === undefined ? 'Default' : `Default (${effective === null ? 'no limit' : minutes(effective)})`;
  return limit === 0 ? 'No limit' : minutes(limit);
}
