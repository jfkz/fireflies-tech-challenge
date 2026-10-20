import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { InjectDb, type Database } from '../db/db.module';
import { appSettings } from '../db/schema';

export type AppSettingRow = typeof appSettings.$inferSelect;

@Injectable()
export class AppSettingsRepository {
  constructor(@InjectDb() private readonly db: Database) {}

  async get(key: string): Promise<AppSettingRow | null> {
    const [row] = await this.db.select().from(appSettings).where(eq(appSettings.key, key));
    return row ?? null;
  }

  async set(key: string, value: unknown, updatedBy: string): Promise<AppSettingRow> {
    const [row] = await this.db
      .insert(appSettings)
      .values({ key, value, updatedBy })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy, updatedAt: new Date() } })
      .returning();
    return row;
  }
}
