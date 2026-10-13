import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import type { Redis } from 'ioredis';
import { AuthGuard } from './auth/auth.guard';
import { AuthModule } from './auth/auth.module';
import { UserThrottlerGuard } from './auth/throttler.guard';
import { ApiExceptionFilter } from './common/http-exception.filter';
import { LoggerModule } from './common/logger.module';
import { AppConfig, ConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { DevicesModule } from './devices/devices.module';
import { DownloadsModule } from './downloads/downloads.module';
import { HealthModule } from './health/health.module';
import { MeetingsModule } from './meetings/meetings.module';
import { PeopleModule } from './people/people.module';
import { QueuesModule } from './queues/queues.module';
import { REDIS, RedisModule } from './redis/redis.module';
import { ReportsModule } from './reports/reports.module';
import { StorageModule } from './storage/storage.module';
import { TasksModule } from './tasks/tasks.module';
import { UsersModule } from './users/users.module';

/** The HTTP API. Stateless: all state is in Postgres, Redis and R2, so it scales by replicas. */
@Module({
  imports: [
    ConfigModule.forRoot(),
    LoggerModule,
    DbModule,
    RedisModule,
    StorageModule,
    QueuesModule,
    ThrottlerModule.forRootAsync({
      inject: [AppConfig, REDIS],
      useFactory: (config: AppConfig, redis: Redis) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: config.env.THROTTLE_LIMIT }],
        storage: new ThrottlerStorageRedisService(redis),
      }),
    }),
    AuthModule,
    UsersModule,
    DevicesModule,
    MeetingsModule,
    TasksModule,
    PeopleModule,
    DownloadsModule,
    ReportsModule,
    HealthModule,
  ],
  providers: [
    // Order matters: authenticate first so the throttler can key on the user.
    { provide: APP_GUARD, useExisting: AuthGuard },
    { provide: APP_GUARD, useClass: UserThrottlerGuard },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule {}
