import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  AdminOverviewQuery,
  GrantAdminRequest,
  ListAdminUsersQuery,
  UpdateAdminSettingsRequest,
  UpdateAdminUserRequest,
  type AdminList,
  type AdminOverview,
  type AdminSettings,
  type AdminUserDetail,
  type AdminUserPage,
} from '@boringtalks/shared';
import { AdminOnly, CurrentUser } from '../auth/auth.decorators';
import { ZodPipe } from '../common/zod.pipe';
import type { UserRow } from '../db/schema';
import { AdminService } from './admin.service';

/** The admin dashboard: usage across all accounts, users, admins and service settings. */
@Controller('admin')
@AdminOnly()
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('overview')
  overview(@Query(new ZodPipe(AdminOverviewQuery)) query: AdminOverviewQuery): Promise<AdminOverview> {
    return this.admin.overview(query);
  }

  @Get('users')
  users(@Query(new ZodPipe(ListAdminUsersQuery)) query: ListAdminUsersQuery): Promise<AdminUserPage> {
    return this.admin.listUsers(query);
  }

  @Get('users/:id')
  user(@Param('id', ParseUUIDPipe) id: string): Promise<AdminUserDetail> {
    return this.admin.user(id);
  }

  @Patch('users/:id')
  updateUser(
    @CurrentUser() actor: UserRow,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(UpdateAdminUserRequest)) body: UpdateAdminUserRequest,
  ): Promise<AdminUserDetail> {
    return this.admin.updateUser(actor, id, body);
  }

  @Get('admins')
  admins(): Promise<AdminList> {
    return this.admin.admins();
  }

  @Post('admins')
  grant(@CurrentUser() actor: UserRow, @Body(new ZodPipe(GrantAdminRequest)) body: GrantAdminRequest): Promise<AdminList> {
    return this.admin.grantAdmin(actor, body.email);
  }

  @Get('settings')
  settings(): Promise<AdminSettings> {
    return this.admin.getSettings();
  }

  @Patch('settings')
  updateSettings(@CurrentUser() actor: UserRow, @Body(new ZodPipe(UpdateAdminSettingsRequest)) body: UpdateAdminSettingsRequest): Promise<AdminSettings> {
    return this.admin.updateSettings(actor, body);
  }
}
