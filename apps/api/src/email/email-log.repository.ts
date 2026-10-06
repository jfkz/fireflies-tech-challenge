import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { InjectDb, type Database } from '../db/db.module';
import { emailLog } from '../db/schema';

@Injectable()
export class EmailLogRepository {
  constructor(@InjectDb() private readonly db: Database) {}

  /** Records the send before it happens; false means this key was already sent. */
  async claim(idempotencyKey: string, userId: string, type: string): Promise<boolean> {
    const rows = await this.db
      .insert(emailLog)
      .values({ idempotencyKey, userId, type })
      .onConflictDoNothing()
      .returning({ key: emailLog.idempotencyKey });
    return rows.length > 0;
  }

  /** Undoes a claim when sending failed, so the retry may send. */
  async release(idempotencyKey: string): Promise<void> {
    await this.db.delete(emailLog).where(eq(emailLog.idempotencyKey, idempotencyKey));
  }
}
