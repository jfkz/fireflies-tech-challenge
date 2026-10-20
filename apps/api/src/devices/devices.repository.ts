import { Injectable } from '@nestjs/common';
import type { DevicePlatform } from '@boringtalks/shared';
import { and, desc, eq, gt, isNull, lt, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { InjectDb, type Database } from '../db/db.module';
import { deviceCodes, devices, users, type DeviceRow, type UserRow } from '../db/schema';

@Injectable()
export class DevicesRepository {
  constructor(@InjectDb() private readonly db: Database) {}

  async insertCode(values: typeof deviceCodes.$inferInsert): Promise<void> {
    await this.db.insert(deviceCodes).values(values);
  }

  /** Marks an unused, unexpired code as used and returns it — atomically, so a code works once. */
  async consumeCode(codeHash: string): Promise<typeof deviceCodes.$inferSelect | null> {
    const [row] = await this.db
      .update(deviceCodes)
      .set({ usedAt: new Date() })
      .where(and(eq(deviceCodes.codeHash, codeHash), isNull(deviceCodes.usedAt), gt(deviceCodes.expiresAt, new Date())))
      .returning();
    return row ?? null;
  }

  async insertDevice(values: { userId: string; name: string; tokenHash: string }): Promise<DeviceRow> {
    const [row] = await this.db.insert(devices).values(values).returning();
    return row;
  }

  async findActiveByTokenHash(tokenHash: string): Promise<{ device: DeviceRow; user: UserRow } | null> {
    const [row] = await this.db
      .select({ device: devices, user: users })
      .from(devices)
      .innerJoin(users, eq(users.id, devices.userId))
      .where(and(eq(devices.tokenHash, tokenHash), isNull(devices.revokedAt)));
    return row ?? null;
  }

  /** Bumps last_seen_at, but at most once a minute per device; a new app version is kept at once. */
  async touch(id: string, app?: { platform: DevicePlatform; version: string }): Promise<void> {
    const stale = or(isNull(devices.lastSeenAt), lt(devices.lastSeenAt, sql`now() - interval '1 minute'`));
    const moved = app ? or(isDistinctFrom(devices.platform, app.platform), isDistinctFrom(devices.appVersion, app.version)) : undefined;
    await this.db
      .update(devices)
      .set({ lastSeenAt: new Date(), ...(app ? { platform: app.platform, appVersion: app.version } : {}) })
      .where(and(eq(devices.id, id), moved ? or(stale, moved) : stale));
  }

  listActive(userId: string): Promise<DeviceRow[]> {
    return this.db
      .select()
      .from(devices)
      .where(and(eq(devices.userId, userId), isNull(devices.revokedAt)))
      .orderBy(desc(devices.createdAt));
  }

  async findById(id: string): Promise<DeviceRow | null> {
    const [row] = await this.db.select().from(devices).where(eq(devices.id, id));
    return row ?? null;
  }

  async revoke(userId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .update(devices)
      .set({ revokedAt: new Date() })
      .where(and(eq(devices.id, id), eq(devices.userId, userId), isNull(devices.revokedAt)))
      .returning({ id: devices.id });
    return rows.length > 0;
  }
}

const isDistinctFrom = (column: SQLWrapper, value: string): SQL => sql`${column} is distinct from ${value}`;
