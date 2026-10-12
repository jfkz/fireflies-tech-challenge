import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DeviceTokensService } from './device-tokens.service';
import { DevicesController } from './devices.controller';
import { DevicesService, toDevice } from './devices.service';
import { user } from '../testing/fixtures';
import type { DeviceRow } from '../db/schema';

const device = (o: Partial<DeviceRow> = {}): DeviceRow => ({
  id: '33333333-3333-4333-8333-333333333333',
  userId: user().id,
  name: 'MacBook Air',
  tokenHash: 'h',
  createdAt: new Date('2026-10-06T10:00:00Z'),
  lastSeenAt: null,
  revokedAt: null,
  ...o,
});

function setup() {
  const repo = {
    insertCode: vi.fn(),
    consumeCode: vi.fn(),
    insertDevice: vi.fn(),
    findActiveByTokenHash: vi.fn(),
    touch: vi.fn(),
    listActive: vi.fn(),
    revoke: vi.fn(),
  };
  const users = { findById: vi.fn() };
  const jobs = { email: vi.fn() };
  const tokens = new DeviceTokensService(repo as never);
  const service = new DevicesService(repo as never, tokens, users as never, jobs as never);
  return { repo, users, jobs, tokens, service };
}

const verifier = 'x'.repeat(50);
const challenge = createHash('sha256').update(verifier).digest('base64url');

describe('device link (PKCE)', () => {
  it('issues a one-time code bound to the challenge and the user', async () => {
    const { repo, service } = setup();
    const res = await service.authorize(user(), { codeChallenge: challenge, deviceName: 'MacBook Air' });
    expect(res.expiresInSec).toBe(600);
    expect(res.redirectUrl).toBe(`boringtalks://callback?code=${res.code}`);
    const stored = repo.insertCode.mock.calls[0][0];
    expect(stored).toMatchObject({ userId: user().id, codeChallenge: challenge, deviceName: 'MacBook Air' });
    expect(stored.codeHash).not.toContain(res.code);
  });

  it('sends BoringTalks Dev its code on its own scheme', async () => {
    const { service } = setup();
    const res = await service.authorize(user(), { codeChallenge: challenge, deviceName: 'MacBook Air', app: 'dev' });
    expect(res.redirectUrl).toBe(`boringtalks-dev://callback?code=${res.code}`);
  });

  it('swaps code + verifier for a device token and emails a security notice', async () => {
    const { repo, users, jobs, service } = setup();
    repo.consumeCode.mockResolvedValue({ userId: user().id, codeChallenge: challenge, deviceName: 'MacBook Air' });
    users.findById.mockResolvedValue(user());
    repo.insertDevice.mockImplementation((v: { tokenHash: string }) => Promise.resolve(device({ tokenHash: v.tokenHash })));
    const res = await service.exchange({ code: 'c', codeVerifier: verifier });
    expect(res.token).toMatch(/^btd_[A-Za-z0-9_-]{43}$/);
    expect(res.user).toEqual({ email: 'ann@example.com', name: 'Ann' });
    expect(repo.insertDevice.mock.calls[0][0].tokenHash).toBe(createHash('sha256').update(res.token).digest('hex'));
    expect(jobs.email).toHaveBeenCalledWith({ type: 'device-connected', userId: user().id, deviceId: res.deviceId });
  });

  it('rejects a wrong verifier, a used code and a deleted user', async () => {
    const { repo, users, service } = setup();
    repo.consumeCode.mockResolvedValueOnce({ userId: user().id, codeChallenge: challenge, deviceName: 'M' });
    await expect(service.exchange({ code: 'c', codeVerifier: 'y'.repeat(50) })).rejects.toBeInstanceOf(BadRequestException);
    repo.consumeCode.mockResolvedValueOnce(null);
    await expect(service.exchange({ code: 'c', codeVerifier: verifier })).rejects.toBeInstanceOf(BadRequestException);
    repo.consumeCode.mockResolvedValueOnce({ userId: user().id, codeChallenge: challenge, deviceName: 'M' });
    users.findById.mockResolvedValue(null);
    await expect(service.exchange({ code: 'c', codeVerifier: verifier })).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.insertDevice).not.toHaveBeenCalled();
  });

  it('lists and revokes devices', async () => {
    const { repo, service } = setup();
    repo.listActive.mockResolvedValue([device({ lastSeenAt: new Date('2026-10-06T11:00:00Z') })]);
    await expect(service.list(user())).resolves.toEqual([
      { id: device().id, name: 'MacBook Air', createdAt: '2026-10-06T10:00:00.000Z', lastSeenAt: '2026-10-06T11:00:00.000Z' },
    ]);
    repo.revoke.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(service.revoke(user(), device().id)).resolves.toBeUndefined();
    await expect(service.revoke(user(), device().id)).rejects.toBeInstanceOf(NotFoundException);
    expect(toDevice(device()).lastSeenAt).toBeNull();
  });
});

describe('DeviceTokensService', () => {
  it('authenticates by hash and touches a stale device', async () => {
    const { repo, tokens } = setup();
    const { token, tokenHash } = tokens.issue();
    repo.findActiveByTokenHash.mockResolvedValue({ device: device(), user: user() });
    await expect(tokens.authenticate(token)).resolves.toEqual({ user: user(), deviceId: device().id });
    expect(repo.findActiveByTokenHash).toHaveBeenCalledWith(tokenHash);
    expect(repo.touch).toHaveBeenCalledTimes(1);
  });

  it('skips the write when the device was seen in the last minute', async () => {
    const { repo, tokens } = setup();
    repo.findActiveByTokenHash.mockResolvedValue({ device: device({ lastSeenAt: new Date() }), user: user() });
    await tokens.authenticate('btd_x');
    expect(repo.touch).not.toHaveBeenCalled();
  });

  it('returns null for unknown or revoked tokens', async () => {
    const { repo, tokens } = setup();
    repo.findActiveByTokenHash.mockResolvedValue(null);
    await expect(tokens.authenticate('btd_x')).resolves.toBeNull();
  });
});

describe('DevicesController', () => {
  it('delegates to the service', async () => {
    const service = { authorize: vi.fn(() => 'a'), exchange: vi.fn(() => 't'), list: vi.fn(() => []), revoke: vi.fn() };
    const c = new DevicesController(service as never);
    expect(await c.authorize(user(), { codeChallenge: challenge, deviceName: 'M' })).toBe('a');
    expect(await c.token({ code: 'c', codeVerifier: verifier })).toBe('t');
    expect(await c.list(user())).toEqual([]);
    await c.revoke(user(), device().id);
    expect(service.revoke).toHaveBeenCalledWith(user(), device().id);
  });
});
