import { testConfig } from '../testing/fixtures';
import { AnalyticsService, createAnalyticsClient } from './analytics.service';

describe('AnalyticsService', () => {
  it('sends events by user id, saying which environment they come from', () => {
    const client = { capture: vi.fn(), shutdown: vi.fn().mockResolvedValue(undefined) };
    const analytics = new AnalyticsService(testConfig({ WEB_URL: 'https://dev.boringtalks.lol' }), client);
    expect(analytics.enabled).toBe(true);
    analytics.capture('u1', 'meeting_created', { source: 'windows' });
    expect(client.capture).toHaveBeenCalledWith({
      distinctId: 'u1',
      event: 'meeting_created',
      properties: { source: 'windows', environment: 'dev.boringtalks.lol', $lib_source: 'api' },
    });
  });

  it('does nothing without a key, and never fails the request', async () => {
    const off = new AnalyticsService(testConfig(), null);
    expect(off.enabled).toBe(false);
    off.capture('u1', 'user_signed_up');
    await off.onModuleDestroy();

    const broken = { capture: vi.fn(() => { throw new Error('queue full'); }), shutdown: vi.fn().mockRejectedValue(new Error('offline')) };
    const analytics = new AnalyticsService(testConfig(), broken);
    expect(() => analytics.capture('u1', 'meeting_ready')).not.toThrow();
    await expect(analytics.onModuleDestroy()).resolves.toBeUndefined();
    expect(broken.shutdown).toHaveBeenCalled();
  });

  it('makes a PostHog client only when POSTHOG_KEY is set', async () => {
    expect(createAnalyticsClient(testConfig())).toBeNull();
    expect(createAnalyticsClient(testConfig({ POSTHOG_KEY: '' }))).toBeNull();
    const client = createAnalyticsClient(testConfig({ POSTHOG_KEY: 'phc_test', POSTHOG_HOST: 'http://127.0.0.1:9' }));
    expect(client).not.toBeNull();
    await client!.shutdown();
    expect(testConfig().env.POSTHOG_HOST).toBe('https://eu.i.posthog.com');
  });
});
