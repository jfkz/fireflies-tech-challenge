import { Controller, Get, Query } from '@nestjs/common';
import { ListTasksQuery, type TaskPage } from '@boringtalks/shared';
import { CurrentUser } from '../auth/auth.decorators';
import { ZodPipe } from '../common/zod.pipe';
import type { UserRow } from '../db/schema';
import { TasksService } from './tasks.service';

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  list(@CurrentUser() user: UserRow, @Query(new ZodPipe(ListTasksQuery)) query: ListTasksQuery): Promise<TaskPage> {
    return this.tasks.list(user, query);
  }
}
