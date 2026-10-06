import { Module } from '@nestjs/common';
import { MeetingsModule } from '../meetings/meetings.module';
import { MeController } from './me.controller';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

@Module({
  imports: [MeetingsModule],
  controllers: [MeController],
  providers: [UsersRepository, UsersService],
  exports: [UsersService, UsersRepository],
})
export class UsersModule {}
