import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { AppConfig } from '../config/config.module';
import { InjectDb, type Database } from '../db/db.module';
import { InjectRedis } from '../redis/redis.module';

export interface Health {
  status: 'ok' | 'error';
  version: string;
  commit: string;
  checks: { db: boolean; redis: boolean };
}

@Injectable()
export class HealthService {
  constructor(
    private readonly config: AppConfig,
    @InjectDb() private readonly db: Database,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  async check(): Promise<Health> {
    const [db, redis] = await Promise.all([
      probe(() => this.db.execute(sql`select 1`)),
      probe(async () => (await this.redis.ping()) === 'PONG'),
    ]);
    return {
      status: db && redis ? 'ok' : 'error',
      version: this.config.env.APP_VERSION,
      commit: this.config.env.GIT_SHA,
      checks: { db, redis },
    };
  }
}

async function probe(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 2_000).unref());
    return (await Promise.race([fn(), timeout])) !== false;
  } catch {
    return false;
  }
}
