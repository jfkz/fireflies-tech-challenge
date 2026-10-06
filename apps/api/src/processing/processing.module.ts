import { Module } from '@nestjs/common';
import { AppConfig } from '../config/config.module';
import { MeetingsModule } from '../meetings/meetings.module';
import { UsersModule } from '../users/users.module';
import { FakeSummarizer, FakeTranscriber } from './fake-ai';
import { GatewaySummarizer, SUMMARY_LANGUAGE_MODEL } from './gateway-summarizer';
import { GatewayTranscriber } from './gateway-transcriber';
import { PipelineService } from './pipeline.service';
import { SummarizeProcessor, TranscribeProcessor } from './processors';
import { Summarizer } from './summarizer';
import { Transcriber } from './transcriber';

/** Worker-side meeting pipeline: transcribe and summarize processors. */
@Module({
  imports: [MeetingsModule, UsersModule],
  providers: [
    PipelineService,
    TranscribeProcessor,
    SummarizeProcessor,
    { provide: SUMMARY_LANGUAGE_MODEL, inject: [AppConfig], useFactory: (c: AppConfig) => c.env.SUMMARY_MODEL },
    GatewaySummarizer,
    GatewayTranscriber,
    FakeSummarizer,
    FakeTranscriber,
    {
      provide: Summarizer,
      inject: [AppConfig, GatewaySummarizer, FakeSummarizer],
      useFactory: (c: AppConfig, real: GatewaySummarizer, fake: FakeSummarizer) => (c.env.AI_FAKE ? fake : real),
    },
    {
      provide: Transcriber,
      inject: [AppConfig, GatewayTranscriber, FakeTranscriber],
      useFactory: (c: AppConfig, real: GatewayTranscriber, fake: FakeTranscriber) => (c.env.AI_FAKE ? fake : real),
    },
  ],
  exports: [PipelineService],
})
export class ProcessingModule {}
