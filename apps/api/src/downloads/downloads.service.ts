import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DownloadPlatform, Downloads, LatestDownload } from '@boringtalks/shared';
import { AppConfig } from '../config/config.module';

export const DOWNLOADS_CACHE_MS = 5 * 60 * 1000;
/** A missing or unreadable manifest is retried sooner, so a fresh release shows up quickly. */
export const DOWNLOADS_MISS_CACHE_MS = 30 * 1000;

/** The manifest each platform's release script writes next to its installer. */
export const MANIFESTS: Record<DownloadPlatform, string> = {
  macos: 'latest.json',
  windows: 'latest-windows.json',
};

type Entry = { at: number; value: LatestDownload | null };

/**
 * Reads each platform's manifest from the public downloads bucket, cached in memory
 * for five minutes (30 s when missing).
 */
@Injectable()
export class DownloadsService {
  private readonly logger = new Logger(DownloadsService.name);
  private readonly cache = new Map<DownloadPlatform, Entry>();
  private readonly inflight = new Map<DownloadPlatform, Promise<LatestDownload | null>>();

  constructor(private readonly config: AppConfig) {}

  /** The latest build for one platform; 404 when there is none or the platform is unknown. */
  async latest(platform: string = 'macos', now = Date.now()): Promise<LatestDownload> {
    const known = DownloadPlatform.safeParse(platform);
    if (!known.success) throw new NotFoundException(`No app for ${platform}`);
    const value = await this.get(known.data, now);
    if (!value) throw new NotFoundException('No build has been published yet');
    return value;
  }

  /** The latest build for every platform, `null` where none has shipped. */
  async all(now = Date.now()): Promise<Downloads> {
    const [macos, windows] = await Promise.all([this.get('macos', now), this.get('windows', now)]);
    return { macos, windows };
  }

  private async get(platform: DownloadPlatform, now: number): Promise<LatestDownload | null> {
    const cached = this.cache.get(platform);
    const ttl = cached?.value ? DOWNLOADS_CACHE_MS : DOWNLOADS_MISS_CACHE_MS;
    if (cached && now - cached.at <= ttl) return cached.value;
    let pending = this.inflight.get(platform);
    if (!pending) {
      pending = this.fetchManifest(platform).finally(() => this.inflight.delete(platform));
      this.inflight.set(platform, pending);
    }
    const value = await pending;
    this.cache.set(platform, { at: now, value });
    return value;
  }

  private async fetchManifest(platform: DownloadPlatform): Promise<LatestDownload | null> {
    const file = MANIFESTS[platform];
    const url = `${this.config.env.DOWNLOADS_BASE_URL.replace(/\/$/, '')}/${file}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (!res.ok) return null;
      const parsed = LatestDownload.safeParse(await res.json());
      if (!parsed.success) {
        this.logger.warn({ url }, `${file} does not match the schema`);
        return null;
      }
      if (parsed.data.platform !== platform) {
        this.logger.warn({ url, platform: parsed.data.platform }, `${file} describes another platform`);
        return null;
      }
      return parsed.data;
    } catch (err) {
      this.logger.warn({ url, err: (err as Error).message }, `could not fetch ${file}`);
      return null;
    }
  }
}
