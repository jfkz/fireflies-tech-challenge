import { Module } from '@nestjs/common';
import { MeetingsModule } from '../meetings/meetings.module';
import { BotsController } from './bots.controller';
import { BotsService } from './bots.service';

/** API side of meeting bots: send one, call it back, follow it through webhooks. */
@Module({ imports: [MeetingsModule], controllers: [BotsController], providers: [BotsService] })
export class BotsModule {}
