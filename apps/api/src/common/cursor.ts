/** Opaque keyset cursor over (started_at desc, id desc). */
export interface MeetingCursor {
  startedAt: Date;
  id: string;
}

export function encodeCursor(c: MeetingCursor): string {
  return Buffer.from(JSON.stringify([c.startedAt.toISOString(), c.id])).toString('base64url');
}

/** Returns null for anything that is not a cursor this API produced. */
export function decodeCursor(raw: string): MeetingCursor | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!Array.isArray(value) || value.length !== 2) return null;
    const [iso, id] = value as unknown[];
    if (typeof iso !== 'string' || typeof id !== 'string') return null;
    const startedAt = new Date(iso);
    if (Number.isNaN(startedAt.getTime()) || !/^[0-9a-f-]{36}$/i.test(id)) return null;
    return { startedAt, id };
  } catch {
    return null;
  }
}
