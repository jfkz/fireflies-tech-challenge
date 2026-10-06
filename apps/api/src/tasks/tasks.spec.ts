import { BadRequestException } from '@nestjs/common';
import { MeetingsRepository } from '../meetings/meetings.repository';
import { createTestDb } from '../testing/pglite';
import { user } from '../testing/fixtures';
import { UsersRepository } from '../users/users.repository';
import type { Database } from '../db/db.module';
import { decodeTaskCursor, encodeTaskCursor } from './task-cursor';
import { TasksController } from './tasks.controller';
import { TasksRepository } from './tasks.repository';
import { TasksService } from './tasks.service';

let db: Database;
let close: () => Promise<void>;
let tasks: TasksRepository;
let service: TasksService;
let me: ReturnType<typeof user>;

const item = (id: string, owner: string | null, dueDate: string | null, done = false) => ({ id, text: `Task ${id}`, owner, due: dueDate && 'soon', dueDate, done });

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const users = new UsersRepository(db);
  const meetings = new MeetingsRepository(db);
  tasks = new TasksRepository(db);
  service = new TasksService(tasks);
  me = user({ id: (await users.insertIfAbsent({ firebaseUid: 'fb-tasks', email: null, name: null }))!.id });
  const other = (await users.insertIfAbsent({ firebaseUid: 'fb-other', email: null, name: null }))!.id;
  const meeting = async (userId: string, title: string, startedAt: string, items: ReturnType<typeof item>[]) => {
    const m = await meetings.create({ userId, title, status: 'ready', source: 'macos', startedAt: new Date(startedAt) });
    await meetings.saveSummary(m.id, { summary: 's', keyTopics: [], decisions: [], model: 'm', actionItems: items }, {});
  };
  await meeting(me.id, 'Older', '2026-10-01T10:00:00Z', [item('o1', 'Maya', '2026-10-09'), item('o2', 'You', null), item('o3', 'You', '2026-10-02', true)]);
  await meeting(me.id, 'Newer', '2026-10-05T10:00:00Z', [item('n1', 'You', '2026-10-07'), item('n2', 'Maya', null), item('n3', 'Leo', '2026-10-09')]);
  await meeting(other, 'Not mine', '2026-10-05T10:00:00Z', [item('x1', 'You', '2026-10-01')]);
}, 30_000);

afterAll(() => close());

describe('tasks', () => {
  it('lists open tasks soonest due first, undated last, newest meeting first on ties', async () => {
    const page = await service.list(me, { status: 'open', limit: 100 });
    expect(page.items.map((t) => t.id)).toEqual(['n1', 'n3', 'o1', 'n2', 'o2']);
    expect(page.items[0]).toMatchObject({ dueDate: '2026-10-07', meeting: { title: 'Newer', startedAt: '2026-10-05T10:00:00.000Z' } });
    expect(page.nextCursor).toBeNull();
  });

  it('pages through every task with the keyset cursor', async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await service.list(me, { status: 'all', limit: 2, cursor });
      seen.push(...page.items.map((t) => t.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toEqual(['n1', 'n3', 'o1', 'n2', 'o2', 'o3']);
  });

  it('filters by owner and by done', async () => {
    expect((await service.list(me, { status: 'open', owner: 'Maya', limit: 10 })).items.map((t) => t.id)).toEqual(['o1', 'n2']);
    expect((await service.list(me, { status: 'done', limit: 10 })).items.map((t) => t.id)).toEqual(['o3']);
  });

  it('rejects a forged cursor', async () => {
    await expect(service.list(me, { status: 'open', limit: 10, cursor: 'nope' })).rejects.toBeInstanceOf(BadRequestException);
    expect(decodeTaskCursor(Buffer.from('[true,"x","y","z",1]').toString('base64url'))).toBeNull();
    const c = { done: false, dueSort: '2026-10-09', startedAt: new Date('2026-10-01T10:00:00Z'), meetingId: '22222222-2222-4222-8222-222222222222', idx: 0 };
    expect(decodeTaskCursor(encodeTaskCursor(c))).toEqual(c);
  });

  it('is exposed at GET /tasks', async () => {
    const s = { list: vi.fn(() => 'page') };
    expect(await new TasksController(s as never).list(me, { status: 'open', limit: 5 })).toBe('page');
  });
});
