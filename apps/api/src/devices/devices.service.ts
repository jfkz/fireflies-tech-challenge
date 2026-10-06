import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DEVICE_CALLBACK_URL,
  type AuthorizeDeviceRequest,
  type AuthorizeDeviceResponse,
  type Device,
  type DeviceTokenRequest,
  type DeviceTokenResponse,
} from '@boringtalks/shared';
import { randomToken, sha256Hex, verifyPkce } from '../common/crypto';
import type { DeviceRow, UserRow } from '../db/schema';
import { JobsService } from '../queues/jobs.service';
import { UsersRepository } from '../users/users.repository';
import { DeviceTokensService } from './device-tokens.service';
import { DevicesRepository } from './devices.repository';

export const DEVICE_CODE_TTL_SEC = 10 * 60;

@Injectable()
export class DevicesService {
  constructor(
    private readonly repo: DevicesRepository,
    private readonly tokens: DeviceTokensService,
    private readonly users: UsersRepository,
    private readonly jobs: JobsService,
  ) {}

  /** Dashboard step: binds a one-time code to the signed-in user and the app's PKCE challenge. */
  async authorize(user: UserRow, body: AuthorizeDeviceRequest): Promise<AuthorizeDeviceResponse> {
    const code = randomToken(24);
    await this.repo.insertCode({
      codeHash: sha256Hex(code),
      userId: user.id,
      codeChallenge: body.codeChallenge,
      deviceName: body.deviceName,
      expiresAt: new Date(Date.now() + DEVICE_CODE_TTL_SEC * 1000),
    });
    return {
      code,
      expiresInSec: DEVICE_CODE_TTL_SEC,
      redirectUrl: `${DEVICE_CALLBACK_URL}?code=${encodeURIComponent(code)}`,
    };
  }

  /** App step: swaps the code + PKCE verifier for a device token. */
  async exchange(body: DeviceTokenRequest): Promise<DeviceTokenResponse> {
    const code = await this.repo.consumeCode(sha256Hex(body.code));
    // Either way the code is gone: a wrong verifier burns it, so it cannot be brute-forced.
    if (!code || !verifyPkce(body.codeVerifier, code.codeChallenge)) {
      throw new BadRequestException('Invalid, expired or already used code');
    }
    const user = await this.users.findById(code.userId);
    if (!user) throw new BadRequestException('Invalid, expired or already used code');
    const { token, tokenHash } = this.tokens.issue();
    const device = await this.repo.insertDevice({ userId: user.id, name: code.deviceName, tokenHash });
    await this.jobs.email({ type: 'device-connected', userId: user.id, deviceId: device.id });
    return { token, deviceId: device.id, user: { email: user.email, name: user.name } };
  }

  async list(user: UserRow): Promise<Device[]> {
    return (await this.repo.listActive(user.id)).map(toDevice);
  }

  async revoke(user: UserRow, id: string): Promise<void> {
    if (!(await this.repo.revoke(user.id, id))) throw new NotFoundException('Device not found');
  }
}

export function toDevice(row: DeviceRow): Device {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
  };
}
