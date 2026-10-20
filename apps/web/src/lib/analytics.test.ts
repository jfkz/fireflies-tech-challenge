import { afterEach, describe, expect, it, vi } from 'vitest';

const posthog = vi.hoisted(() => ({
  init: vi.fn(),
  register: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
  set_config: vi.fn(),
}));
vi.mock('posthog-js', () => ({ default: posthog }));

async function load(key?: string) {
  if (key) vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', key);
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://dev.boringtalks.lol');
  const mod = await import('./analytics');
  mod.resetAnalyticsClient();
  return mod.analytics;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('analytics', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('never loads PostHog without a key', async () => {
    const analytics = await load();
    analytics.pageview('https://dev.boringtalks.lol/');
    analytics.track('download_clicked', { platform: 'windows' });
    analytics.identify('u1');
    analytics.reset();
    await settle();
    expect(posthog.init).not.toHaveBeenCalled();
    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it('starts once, through our own proxy, without recording sessions or cookies', async () => {
    const analytics = await load('phc_test');
    analytics.pageview('https://dev.boringtalks.lol/meetings');
    analytics.track('recording_started', { withTab: true });
    await settle();
    expect(posthog.init).toHaveBeenCalledTimes(1);
    expect(posthog.init).toHaveBeenCalledWith(
      'phc_test',
      expect.objectContaining({ api_host: '/ingest', persistence: 'memory', capture_pageview: false, disable_session_recording: true, person_profiles: 'identified_only' }),
    );
    expect(posthog.register).toHaveBeenCalledWith(expect.objectContaining({ app: 'web', environment: 'dev.boringtalks.lol' }));
    expect(posthog.capture).toHaveBeenCalledWith('$pageview', { $current_url: 'https://dev.boringtalks.lol/meetings' });
    expect(posthog.capture).toHaveBeenCalledWith('recording_started', { withTab: true });
  });

  it('remembers who signed in, and forgets them on sign-out', async () => {
    const analytics = await load('phc_test');
    analytics.identify('u1', { isAdmin: false });
    await settle();
    expect(posthog.set_config).toHaveBeenLastCalledWith({ persistence: 'localStorage' });
    expect(posthog.identify).toHaveBeenCalledWith('u1', { isAdmin: false });

    analytics.reset();
    await settle();
    expect(posthog.reset).toHaveBeenCalled();
    expect(posthog.set_config).toHaveBeenLastCalledWith({ persistence: 'memory' });
  });
});
