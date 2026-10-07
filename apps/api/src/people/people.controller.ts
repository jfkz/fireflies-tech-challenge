import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { PeopleQuery, RenamePersonRequest, type PeopleList, type PersonDetail } from '@boringtalks/shared';
import { CurrentUser } from '../auth/auth.decorators';
import { ZodPipe } from '../common/zod.pipe';
import type { UserRow } from '../db/schema';
import { PeopleService } from './people.service';

@Controller('people')
export class PeopleController {
  constructor(private readonly people: PeopleService) {}

  /** Everyone the user meets, most time together first (`?days=30` for the last 30 days). */
  @Get()
  list(@CurrentUser() user: UserRow, @Query(new ZodPipe(PeopleQuery)) query: PeopleQuery): Promise<PeopleList> {
    return this.people.list(user, query.days);
  }

  /** One person by name (case-insensitive). */
  @Get(':name')
  get(@CurrentUser() user: UserRow, @Param('name') name: string): Promise<PersonDetail> {
    return this.people.get(user, name);
  }

  /** Renames (or merges into another name) in every meeting. */
  @Patch(':name')
  rename(@CurrentUser() user: UserRow, @Param('name') name: string, @Body(new ZodPipe(RenamePersonRequest)) body: RenamePersonRequest): Promise<PersonDetail> {
    return this.people.rename(user, name, body.name);
  }
}
