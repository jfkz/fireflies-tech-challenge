import { testConfig } from '../testing/fixtures';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('health', () => {
  const config = testConfig({ APP_VERSION: '1.0.0', GIT_SHA: 'abc123' });

  it('is ok when Postgres and Redis answer', async () => {
    const s = new HealthService(config, { execute: vi.fn().mockResolvedValue({}) } as never, { ping: vi.fn().mockResolvedValue('PONG') } as never);
    await expect(s.check()).resolves.toEqual({ status: 'ok', version: '1.0.0', commit: 'abc123', checks: { db: true, redis: true } });
  });

  it('reports failures and answers 503', async () => {
    const s = new HealthService(config, { execute: vi.fn().mockRejectedValue(new Error('down')) } as never, { ping: vi.fn().mockResolvedValue('NOPE') } as never);
    const res = { status: vi.fn() };
    const body = await new HealthController(s).check(res as never);
    expect(body).toMatchObject({ status: 'error', checks: { db: false, redis: false } });
    expect(res.status).toHaveBeenCalledWith(503);
  });
});
