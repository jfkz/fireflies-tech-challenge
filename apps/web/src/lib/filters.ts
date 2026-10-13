import type { MeetingFilters } from '@/hooks/queries';

/** The filter keys kept in the meeting list's URL, so a filtered view can be shared and survives a reload. */
const KEYS = ['q', 'speaker', 'topic', 'from', 'to'] as const satisfies readonly (keyof MeetingFilters)[];

export function filtersFromParams(params: Pick<URLSearchParams, 'get'>): MeetingFilters {
  const out: MeetingFilters = {};
  for (const k of KEYS) {
    const v = params.get(k)?.trim();
    if (v) out[k] = v;
  }
  return out;
}

/** "?speaker=Maya&topic=Pricing", or "" when nothing is filtered. */
export function filtersToSearch(filters: MeetingFilters): string {
  const p = new URLSearchParams();
  for (const k of KEYS) {
    const v = filters[k]?.trim();
    if (v) p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Link to the meeting list filtered by one speaker or topic. */
export function meetingsHref(filters: MeetingFilters): string {
  return `/meetings${filtersToSearch(filters)}`;
}

export function hasFilters(filters: MeetingFilters): boolean {
  return KEYS.some((k) => !!filters[k]);
}

/** The list's page number from `?page=`: 1 when missing or not a positive whole number. */
export function pageFromParams(params: Pick<URLSearchParams, 'get'>): number {
  const n = Number(params.get('page'));
  return Number.isSafeInteger(n) && n > 1 ? n : 1;
}

/** The list's URL for one page of the current filters; page 1 has no `page` parameter. */
export function pageHref(pathname: string, filters: MeetingFilters, page: number): string {
  const search = filtersToSearch(filters);
  if (page <= 1) return `${pathname}${search}`;
  return `${pathname}${search ? `${search}&` : '?'}page=${page}`;
}

/**
 * The page numbers to show around `current`, with null for a gap: 1 … 4 5 6 … 12. The first and last
 * pages and one on each side of the current one are always there; a gap of one page is shown as that page.
 */
export function pageRange(current: number, count: number): (number | null)[] {
  const shown = new Set([1, count, current - 1, current, current + 1].filter((n) => n >= 1 && n <= count));
  const out: (number | null)[] = [];
  let prev = 0;
  for (const n of [...shown].sort((a, b) => a - b)) {
    if (n - prev === 2) out.push(n - 1);
    else if (n - prev > 2) out.push(null);
    out.push(n);
    prev = n;
  }
  return out;
}
