import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { PostHog } from 'posthog-node';
import { AppConfig } from '../config/config.module';

/** What the API and the worker tell PostHog. Never meeting content: titles, transcripts, summaries. */
export type AnalyticsEvent =
  | 'user_signed_up'
  | 'device_connected'
  | 'meeting_created'
  | 'meeting_completed'
  | 'meeting_ready'
  | 'meeting_failed'
  | 'problem_report_sent';

export type AnalyticsProperties = Record<string, string | number | boolean | null | undefined>;

/** The part of posthog-node used here, so tests can pass a fake. */
export interface AnalyticsClient {
  capture(message: { distinctId: string; event: string; properties?: Record<string, unknown> }): void;
  shutdown(): Promise<void>;
}

/** Makes the PostHog client from the environment; null (tracking off) without POSTHOG_KEY. */
export function createAnalyticsClient(config: AppConfig): AnalyticsClient | null {
  const key = config.env.POSTHOG_KEY;
  return key ? new PostHog(key, { host: config.env.POSTHOG_HOST, flushAt: 20, flushInterval: 10_000 }) : null;
}

/**
 * Product events from the server side, by user id (the same distinct id the dashboard identifies
 * with), so the desktop apps need no SDK. Each event says which environment it came from. Nothing
 * happens without POSTHOG_KEY; a failure to send never fails the request.
 */
@Injectable()
export class AnalyticsService implements OnModuleDestroy {
  private readonly logger = new Logger(AnalyticsService.name);
  private readonly environment: string;

  constructor(
    config: AppConfig,
    private readonly client: AnalyticsClient | null,
  ) {
    this.environment = new URL(config.env.WEB_URL).host;
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  capture(userId: string, event: AnalyticsEvent, properties: AnalyticsProperties = {}): void {
    if (!this.client) return;
    try {
      this.client.capture({ distinctId: userId, event, properties: { ...properties, environment: this.environment, $lib_source: 'api' } });
    } catch (error) {
      this.logger.warn({ event, err: error }, 'analytics event not sent');
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.shutdown().catch(() => {});
  }
}
