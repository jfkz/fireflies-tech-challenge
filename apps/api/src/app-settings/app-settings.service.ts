import { Injectable } from '@nestjs/common';
import { DEFAULT_RECORDING_LIMIT_MINUTES } from '@boringtalks/shared';
import { AppSettingsRepository, type AppSettingRow } from './app-settings.repository';

export const RECORDING_LIMIT_KEY = 'recording.limitMinutes';

/** How long a value read from the database is trusted (other replicas see a change within this). */
const CACHE_MS = 60_000;

/** Settings for the whole service, edited on the admin dashboard. */
@Injectable()
export class AppSettingsService {
  private cached: { row: AppSettingRow | null; at: number } | null = null;

  constructor(private readonly repo: AppSettingsRepository) {}

  /** For everyone without a limit of their own; 0 = no limit. */
  async recordingLimitMinutes(): Promise<number> {
    return minutesOf((await this.recordingLimitRow())?.value);
  }

  async recordingLimitRow(): Promise<AppSettingRow | null> {
    if (this.cached && Date.now() - this.cached.at < CACHE_MS) return this.cached.row;
    const row = await this.repo.get(RECORDING_LIMIT_KEY);
    this.cached = { row, at: Date.now() };
    return row;
  }

  async setRecordingLimitMinutes(minutes: number, by: string): Promise<AppSettingRow> {
    const row = await this.repo.set(RECORDING_LIMIT_KEY, minutes, by);
    this.cached = { row, at: Date.now() };
    return row;
  }
}

/** The stored value, or the default when it is missing or not a whole number of minutes. */
export function minutesOf(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : DEFAULT_RECORDING_LIMIT_MINUTES;
}
