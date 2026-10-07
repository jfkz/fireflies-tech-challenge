import { Body, Controller, Get, Patch } from '@nestjs/common';
import { UpdateSettingsRequest, type Me } from '@boringtalks/shared';
import { CurrentUser } from '../auth/auth.decorators';
import { ZodPipe } from '../common/zod.pipe';
import type { UserRow } from '../db/schema';
import { RecallClient } from '../recall/recall.client';
import { toMe, UsersService } from './users.service';

@Controller('me')
export class MeController {
  constructor(
    private readonly users: UsersService,
    private readonly recall: RecallClient,
  ) {}

  @Get()
  me(@CurrentUser() user: UserRow): Me {
    return toMe(user, { meetingBot: this.recall.enabled });
  }

  @Patch('settings')
  updateSettings(@CurrentUser() user: UserRow, @Body(new ZodPipe(UpdateSettingsRequest)) body: UpdateSettingsRequest): Promise<Me> {
    return this.users.updateSettings(user, body);
  }
}
