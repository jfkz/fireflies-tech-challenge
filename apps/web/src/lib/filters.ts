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
