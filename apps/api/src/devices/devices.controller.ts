import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  AuthorizeDeviceRequest,
  DeviceTokenRequest,
  type AuthorizeDeviceResponse,
  type Device,
  type DeviceTokenResponse,
} from '@boringtalks/shared';
import { CurrentUser, FirebaseOnly, Public } from '../auth/auth.decorators';
import { ZodPipe } from '../common/zod.pipe';
import type { UserRow } from '../db/schema';
import { DevicesService } from './devices.service';

@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Post('authorize')
  @FirebaseOnly()
  authorize(
    @CurrentUser() user: UserRow,
    @Body(new ZodPipe(AuthorizeDeviceRequest)) body: AuthorizeDeviceRequest,
  ): Promise<AuthorizeDeviceResponse> {
    return this.devices.authorize(user, body);
  }

  @Post('token')
  @Public()
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  token(@Body(new ZodPipe(DeviceTokenRequest)) body: DeviceTokenRequest): Promise<DeviceTokenResponse> {
    return this.devices.exchange(body);
  }

  @Get()
  list(@CurrentUser() user: UserRow): Promise<Device[]> {
    return this.devices.list(user);
  }

  @Delete(':id')
  @HttpCode(204)
  async revoke(@CurrentUser() user: UserRow, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.devices.revoke(user, id);
  }
}
