import { Module } from '@nestjs/common';
import { MeetingsModule } from '../meetings/meetings.module';
import { PeopleController } from './people.controller';
import { PeopleRepository } from './people.repository';
import { PeopleService } from './people.service';

@Module({
  imports: [MeetingsModule],
  controllers: [PeopleController],
  providers: [PeopleRepository, PeopleService],
})
export class PeopleModule {}
