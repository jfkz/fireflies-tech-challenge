import { join } from 'node:path';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { Redis } from 'ioredis';
import { Client } from 'pg';
import { runMigrations } from '../src/migrate';

/** Prepares the docker-compose services for e2e: test database + migrations, empty Redis db, test bucket. */
export default async function setup(): Promise<void> {
  process.loadEnvFile(join(__dirname, '..', '.env.test'));
  const url = new URL(process.env.DATABASE_URL!);
  const dbName = url.pathname.slice(1);
  const admin = new Client({ connectionString: Object.assign(new URL(url), { pathname: '/postgres' }).toString() });
  await admin.connect();
  const exists = await admin.query('select 1 from pg_database where datname = $1', [dbName]);
  if (exists.rowCount === 0) await admin.query(`create database "${dbName}"`);
  await admin.end();
  await runMigrations(process.env.DATABASE_URL!);

  const redis = new Redis(process.env.REDIS_URL!);
  await redis.flushdb();
  await redis.quit();

  const s3 = new S3Client({
    endpoint: process.env.R2_ENDPOINT,
    region: 'auto',
    forcePathStyle: true,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
  });
  await s3.send(new CreateBucketCommand({ Bucket: process.env.R2_BUCKET })).catch((err: { name?: string }) => {
    if (err.name !== 'BucketAlreadyOwnedByYou' && err.name !== 'BucketAlreadyExists') throw err;
  });
  s3.destroy();
}
