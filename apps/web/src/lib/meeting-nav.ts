import type { MeetingChain, MeetingRef } from '@boringtalks/shared';

/** The viewer's local calendar day an instant falls on, as [start, next day's start) ISO instants. */
export function localDayRange(iso: string): { from: string; to: string } {
  const d = new Date(iso);
  // Built from the date parts, so a DST change inside the day still lands on the next midnight.
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  return { from: start.toISOString(), to: end.toISOString() };
}

export interface Neighbours {
  prev: MeetingRef | null;
  next: MeetingRef | null;
  /** 0-based place of the current meeting, and how many there are. */
  index: number;
  total: number;
}

/**
 * Where a meeting sits among others by start time (the meetings of its day). The current one is
 * added if the list missed it, and ties keep a stable order by id.
 */
export function dayNeighbours(current: MeetingRef, others: readonly MeetingRef[]): Neighbours {
  const all = [current, ...others.filter((m) => m.id !== current.id)].sort(
    (a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt) || a.id.localeCompare(b.id),
  );
  const index = all.findIndex((m) => m.id === current.id);
  return { prev: all[index - 1] ?? null, next: all[index + 1] ?? null, index, total: all.length };
}

/** Where a meeting sits in its chain (already oldest first); null when it isn't in it. */
export function chainNeighbours(chain: MeetingChain, id: string): Neighbours | null {
  const index = chain.meetings.findIndex((m) => m.id === id);
  if (index < 0) return null;
  return { prev: chain.meetings[index - 1] ?? null, next: chain.meetings[index + 1] ?? null, index, total: chain.meetings.length };
}

/** Whether a key press came from somewhere the person is typing, where shortcuts must stay out of the way. */
export function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}
