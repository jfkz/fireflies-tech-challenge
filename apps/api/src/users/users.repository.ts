import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { InjectDb, type Database } from '../db/db.module';
import { users, type UserRow } from '../db/schema';

@Injectable()
export class UsersRepository {
  constructor(@InjectDb() private readonly db: Database) {}

  async findById(id: string): Promise<UserRow | null> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id));
    return row ?? null;
  }

  async findByFirebaseUid(uid: string): Promise<UserRow | null> {
    const [row] = await this.db.select().from(users).where(eq(users.firebaseUid, uid));
    return row ?? null;
  }

  /** Inserts the user; returns null when another request created it first. */
  async insertIfAbsent(values: { firebaseUid: string; email: string | null; name: string | null }): Promise<UserRow | null> {
    const [row] = await this.db.insert(users).values(values).onConflictDoNothing({ target: users.firebaseUid }).returning();
    return row ?? null;
  }

  async updateProfile(id: string, values: { email: string | null; name: string | null }): Promise<UserRow> {
    const [row] = await this.db.update(users).set(values).where(eq(users.id, id)).returning();
    return row;
  }

  async updateSettings(id: string, values: { emailOnReady: boolean }): Promise<UserRow> {
    const [row] = await this.db.update(users).set(values).where(eq(users.id, id)).returning();
    return row;
  }
}
