/** Where a page of tasks ended: the sort key of its last row. */
export interface TaskCursor {
  done: boolean;
  /** The due date, or "9999-12-31" for tasks without one (they sort last). */
  dueSort: string;
  startedAt: Date;
  meetingId: string;
  idx: number;
}

export function encodeTaskCursor(c: TaskCursor): string {
  return Buffer.from(JSON.stringify([c.done, c.dueSort, c.startedAt.toISOString(), c.meetingId, c.idx])).toString('base64url');
}

/** Returns null for anything that is not a cursor this API produced. */
export function decodeTaskCursor(raw: string): TaskCursor | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!Array.isArray(value) || value.length !== 5) return null;
    const [done, dueSort, iso, meetingId, idx] = value as unknown[];
    if (typeof done !== 'boolean' || typeof dueSort !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dueSort)) return null;
    if (typeof iso !== 'string' || typeof meetingId !== 'string' || !/^[0-9a-f-]{36}$/i.test(meetingId)) return null;
    if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0) return null;
    const startedAt = new Date(iso);
    if (Number.isNaN(startedAt.getTime())) return null;
    return { done, dueSort, startedAt, meetingId, idx };
  } catch {
    return null;
  }
}
