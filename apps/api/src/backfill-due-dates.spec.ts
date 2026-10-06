import { backfillDueDates } from './backfill-due-dates';
import type { Database } from './db/db.module';
import { MeetingsRepository } from './meetings/meetings.repository';
import { createTestDb } from './testing/pglite';
import { UsersRepository } from './users/users.repository';

describe('backfillDueDates', () => {
  it('dates spoken deadlines from their meeting’s day, keeping ticks', async () => {
    const { db, close } = await createTestDb();
    try {
      const meetings = new MeetingsRepository(db as Database);
      const user = (await new UsersRepository(db as Database).insertIfAbsent({ firebaseUid: 'fb-due', email: null, name: null }))!;
      const m = await meetings.create({ userId: user.id, title: 'Admin page', status: 'ready', source: 'macos', startedAt: new Date('2026-10-06T15:00:00Z') });
      const item = (id: string, due: string | null, dueDate: string | null, done = false) => ({ id, text: id, owner: 'Mike', due, dueDate, done });
      await meetings.saveSummary(
        m.id,
        {
          summary: 's',
          keyTopics: [],
          decisions: [],
          model: 'm',
          actionItems: [
            item('a', 'today or tomorrow mid-day', '2026-10-06', true),
            item('b', 'before Friday', null),
            item('c', 'weekend', null),
            item('d', null, null),
            item('e', 'after the launch', '2026-11-01'),
          ],
        },
        {},
      );
      const dry = await backfillDueDates(db as Database, { dryRun: true });
      expect(dry.checked).toBe(4);
      expect(dry.changed.map((c) => [c.id, c.to])).toEqual([
        ['a', '2026-10-07'],
        ['b', '2026-10-08'],
        ['c', '2026-10-11'],
      ]);
      expect((await meetings.getActionItems(m.id))[0].dueDate).toBe('2026-10-06');

      await backfillDueDates(db as Database);
      const after = await meetings.getActionItems(m.id);
      expect(after.map((a) => a.dueDate)).toEqual(['2026-10-07', '2026-10-08', '2026-10-11', null, '2026-11-01']);
      expect(after[0].done).toBe(true);
      expect((await backfillDueDates(db as Database)).changed).toEqual([]);
    } finally {
      await close();
    }
  }, 30_000);
});
