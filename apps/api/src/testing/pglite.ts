import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { Database } from '../db/db.module';
import * as schema from '../db/schema';

/** In-memory Postgres (WASM) with the real migrations applied, for repository tests. */
export async function createTestDb(): Promise<{ db: Database; close: () => Promise<void> }> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: join(__dirname, '..', '..', 'drizzle') });
  return { db: db as unknown as Database, close: () => client.close() };
}
