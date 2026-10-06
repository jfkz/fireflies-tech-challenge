import { Injectable } from '@nestjs/common';
import type { ListTasksQuery, TaskItem, TaskPage } from '@boringtalks/shared';
import { validationError } from '../common/zod.pipe';
import type { UserRow } from '../db/schema';
import { decodeTaskCursor, encodeTaskCursor } from './task-cursor';
import { NO_DUE, TasksRepository, type TaskRow } from './tasks.repository';

export function toTask(r: TaskRow): TaskItem {
  return {
    id: r.id,
    text: r.text,
    owner: r.owner,
    due: r.due,
    dueDate: r.dueDate,
    done: r.done,
    meeting: { id: r.meetingId, title: r.meetingTitle, startedAt: r.startedAt.toISOString() },
  };
}

/** Action items from every meeting, as one list of things to do. Toggling goes through PATCH /meetings/:id. */
@Injectable()
export class TasksService {
  constructor(private readonly repo: TasksRepository) {}

  async list(user: UserRow, query: ListTasksQuery): Promise<TaskPage> {
    const cursor = query.cursor ? decodeTaskCursor(query.cursor) : null;
    if (query.cursor && !cursor) throw validationError([{ path: 'cursor', message: 'Invalid cursor' }]);
    const rows = await this.repo.list(user.id, { status: query.status, owner: query.owner, cursor, limit: query.limit + 1 });
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map(toTask),
      nextCursor:
        rows.length > query.limit && last
          ? encodeTaskCursor({ done: last.done, dueSort: last.dueDate ?? NO_DUE, startedAt: last.startedAt, meetingId: last.meetingId, idx: last.idx })
          : null,
    };
  }
}
