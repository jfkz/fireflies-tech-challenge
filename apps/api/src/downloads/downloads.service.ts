import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { LatestDownload } from '@boringtalks/shared';
import { AppConfig } from '../config/config.module';

export const DOWNLOADS_CACHE_MS = 5 * 60 * 1000;

/** Reads `latest.json` from the public downloads bucket, cached in memory for five minutes. */
@Injectable()
export class DownloadsService {
  private readonly logger = new Logger(DownloadsService.name);
  private cache: { at: number; value: LatestDownload | null } | null = null;
  private inflight: Promise<LatestDownload | null> | null = null;

  constructor(private readonly config: AppConfig) {}

  async latest(now = Date.now()): Promise<LatestDownload> {
    if (!this.cache || now - this.cache.at > DOWNLOADS_CACHE_MS) {
      this.inflight ??= this.fetchLatest().finally(() => (this.inflight = null));
      this.cache = { at: now, value: await this.inflight };
    }
    if (!this.cache.value) throw new NotFoundException('No build has been published yet');
    return this.cache.value;
  }

  private async fetchLatest(): Promise<LatestDownload | null> {
    const url = `${this.config.env.DOWNLOADS_BASE_URL.replace(/\/$/, '')}/latest.json`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (!res.ok) return null;
      const parsed = LatestDownload.safeParse(await res.json());
      if (!parsed.success) {
        this.logger.warn({ url }, 'latest.json does not match the schema');
        return null;
      }
      return parsed.data;
    } catch (err) {
      this.logger.warn({ url, err: (err as Error).message }, 'could not fetch latest.json');
      return null;
    }
  }
}
