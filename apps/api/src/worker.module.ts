import { Module } from '@nestjs/common';
import { LoggerModule } from './common/logger.module';
import { ConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { EmailModule } from './email/email.module';
import { ProcessingModule } from './processing/processing.module';
import { QueuesModule } from './queues/queues.module';
import { BotImportModule } from './recall/bot-import.module';
import { RecallModule } from './recall/recall.module';
import { RedisModule } from './redis/redis.module';
import { StorageModule } from './storage/storage.module';

/** The background worker: BullMQ processors for transcribe, summarize, email and bot imports. No HTTP. */
@Module({
  imports: [ConfigModule.forRoot(), LoggerModule, DbModule, RedisModule, StorageModule, QueuesModule, ProcessingModule, EmailModule, RecallModule, BotImportModule],
})
export class WorkerModule {}
