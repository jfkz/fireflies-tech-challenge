import { Global, Inject, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import { Redis, type RedisOptions } from 'ioredis';
import { AppConfig } from '../config/config.module';

export const REDIS = Symbol('REDIS');
export const InjectRedis = () => Inject(REDIS);

/**
 * Options shared by every Redis connection. `family: 0` lets ioredis resolve
 * IPv6 hosts (Railway's private network); BullMQ needs `maxRetriesPerRequest: null`.
 */
export function redisOptions(): RedisOptions {
  return { family: 0, maxRetriesPerRequest: null };
}

@Injectable()
class RedisShutdown implements OnApplicationShutdown {
  constructor(@InjectRedis() private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [AppConfig],
      useFactory: (config: AppConfig) => new Redis(config.env.REDIS_URL, redisOptions()),
    },
    RedisShutdown,
  ],
  exports: [REDIS],
})
export class RedisModule {}
