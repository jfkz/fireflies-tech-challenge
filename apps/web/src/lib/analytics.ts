import type { PostHog } from 'posthog-js';
import { env } from './env';

/** Product events from the dashboard and the landing page. Never meeting content. */
export type WebEvent = 'download_clicked' | 'recording_started' | 'recording_stopped' | 'file_uploaded' | 'signed_in';

type Properties = Record<string, string | number | boolean | null | undefined>;

let client: Promise<PostHog | null> | null = null;

/**
 * posthog-js, loaded on first use and only with NEXT_PUBLIC_POSTHOG_KEY, so pages without it (and
 * tests) never download it. Through our own /ingest (next.config rewrites), no session recording,
 * and kept in memory (no cookie) until someone signs in.
 */
function load(): Promise<PostHog | null> {
  if (!env.posthog.key || typeof window === 'undefined') return Promise.resolve(null);
  client ??= import('posthog-js')
    .then(({ default: posthog }) => {
      posthog.init(env.posthog.key!, {
        api_host: '/ingest',
        ui_host: env.posthog.uiHost,
        persistence: 'memory',
        person_profiles: 'identified_only',
        capture_pageview: false,
        capture_pageleave: true,
        disable_session_recording: true,
      });
      posthog.register({ app: 'web', environment: new URL(env.siteUrl).host, appVersion: process.env.NEXT_PUBLIC_APP_VERSION });
      return posthog;
    })
    .catch(() => null);
  return client;
}

export const analytics = {
  pageview(url: string) {
    void load().then((p) => p?.capture('$pageview', { $current_url: url }));
  },
  track(event: WebEvent, properties: Properties = {}) {
    void load().then((p) => p?.capture(event, properties));
  },
  /** Signed in: the same id the API sends its events with; remembered in this browser from now on. */
  identify(userId: string, properties: Properties = {}) {
    void load().then((p) => {
      if (!p) return;
      p.set_config({ persistence: 'localStorage' });
      p.identify(userId, properties);
    });
  },
  /** Signed out: forget who it was. */
  reset() {
    void load().then((p) => {
      if (!p) return;
      p.reset();
      p.set_config({ persistence: 'memory' });
    });
  },
};

/** Tests: start from no client. */
export function resetAnalyticsClient(): void {
  client = null;
}
