import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../config/config.module';
import { redisOptions } from '../redis/redis.module';
import { JobsService } from './jobs.service';
import { BOT_IMPORT_QUEUE, DEFAULT_JOB_OPTIONS, EMAIL_QUEUE, SUMMARIZE_QUEUE, TRANSCRIBE_QUEUE } from './queues';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        connection: { url: config.env.REDIS_URL, ...redisOptions() },
        prefix: config.env.QUEUE_PREFIX,
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      }),
    }),
    BullModule.registerQueue({ name: TRANSCRIBE_QUEUE }, { name: SUMMARIZE_QUEUE }, { name: EMAIL_QUEUE }, { name: BOT_IMPORT_QUEUE }),
  ],
  providers: [JobsService],
  exports: [JobsService, BullModule],
})
export class QueuesModule {}
