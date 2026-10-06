import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { DB, type Database } from '../src/db/db.module';
import { FakeMailSender, MailSender } from '../src/email/mail-sender';
import { REDIS } from '../src/redis/redis.module';
import { WorkerModule } from '../src/worker.module';

export interface Harness {
  app: NestExpressApplication;
  worker: INestApplicationContext;
  http: ReturnType<typeof request>;
  mail: FakeMailSender;
  close: () => Promise<void>;
}

/** Boots the real HTTP app and the real worker (BullMQ processors) in this process. */
export async function startHarness(): Promise<Harness> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false, rawBody: true, logger: false });
  configureApp(app);
  await app.init();
  await app.get<Database>(DB).execute(sql`truncate users cascade`);
  await app.get<Redis>(REDIS).flushdb();
  const worker = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
  await worker.init();
  return {
    app,
    worker,
    http: request(app.getHttpServer()),
    mail: worker.get(MailSender) as FakeMailSender,
    close: async () => {
      await worker.close();
      await app.close();
    },
  };
}

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');

/** An unsigned token like the Firebase Auth emulator issues. */
export function emulatorToken(uid: string, email = `${uid}@example.com`, name: string | null = null): string {
  const now = Math.floor(Date.now() / 1000);
  const project = process.env.FIREBASE_PROJECT_ID!;
  const claims = { iss: `https://securetoken.google.com/${project}`, aud: project, sub: uid, email, name, iat: now, exp: now + 3600 };
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64(claims)}.`;
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

export async function waitFor<T>(fn: () => Promise<T | undefined | null | false>, timeoutMs = 15_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > until) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 100));
  }
}
