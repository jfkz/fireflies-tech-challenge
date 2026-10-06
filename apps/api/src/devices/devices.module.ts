import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { DeviceTokensService } from './device-tokens.service';
import { DevicesController } from './devices.controller';
import { DevicesRepository } from './devices.repository';
import { DevicesService } from './devices.service';

@Module({
  imports: [UsersModule],
  controllers: [DevicesController],
  providers: [DevicesRepository, DeviceTokensService, DevicesService],
  exports: [DeviceTokensService, DevicesRepository],
})
export class DevicesModule {}
