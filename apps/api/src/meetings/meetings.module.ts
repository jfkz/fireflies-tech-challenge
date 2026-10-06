import { Module } from '@nestjs/common';
import { DemoService } from './demo.service';
import { MeetingsController } from './meetings.controller';
import { MeetingsRepository } from './meetings.repository';
import { MeetingsService } from './meetings.service';
import { TranscriptService } from './transcript.service';

@Module({
  controllers: [MeetingsController],
  providers: [MeetingsRepository, MeetingsService, TranscriptService, DemoService],
  exports: [MeetingsRepository, TranscriptService, DemoService],
})
export class MeetingsModule {}
