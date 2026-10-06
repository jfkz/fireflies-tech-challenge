import { Global, Inject, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { AppConfig } from '../config/config.module';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;
export const DB = Symbol('DB');
export const InjectDb = () => Inject(DB);

@Injectable()
export class PgPool extends Pool implements OnApplicationShutdown {
  constructor(config: AppConfig) {
    super({ connectionString: config.env.DATABASE_URL, max: 10 });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.end();
  }
}

@Global()
@Module({
  providers: [
    PgPool,
    { provide: DB, inject: [PgPool], useFactory: (pool: PgPool): Database => drizzle(pool, { schema }) },
  ],
  exports: [DB, PgPool],
})
export class DbModule {}
