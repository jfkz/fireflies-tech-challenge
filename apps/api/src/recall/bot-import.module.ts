import { Module } from '@nestjs/common';
import { MeetingsModule } from '../meetings/meetings.module';
import { BotImportProcessor } from './bot-import.processor';
import { BotImportService } from './bot-import.service';

/** Worker side of meeting bots: import a finished bot's transcript and audio. */
@Module({ imports: [MeetingsModule], providers: [BotImportService, BotImportProcessor] })
export class BotImportModule {}
