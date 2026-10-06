import { Injectable } from '@nestjs/common';
import { DEVICE_TOKEN_PREFIX } from '@boringtalks/shared';
import { randomToken, sha256Hex } from '../common/crypto';
import type { UserRow } from '../db/schema';
import { DevicesRepository } from './devices.repository';

const TOUCH_INTERVAL_MS = 60_000;

/** Long-lived Mac app tokens: `btd_` + 32 random bytes; only the sha256 is stored. */
@Injectable()
export class DeviceTokensService {
  constructor(private readonly repo: DevicesRepository) {}

  issue(): { token: string; tokenHash: string } {
    const token = `${DEVICE_TOKEN_PREFIX}${randomToken(32)}`;
    return { token, tokenHash: sha256Hex(token) };
  }

  async authenticate(token: string): Promise<{ user: UserRow; deviceId: string } | null> {
    const found = await this.repo.findActiveByTokenHash(sha256Hex(token));
    if (!found) return null;
    const last = found.device.lastSeenAt?.getTime() ?? 0;
    if (Date.now() - last > TOUCH_INTERVAL_MS) await this.repo.touch(found.device.id);
    return { user: found.user, deviceId: found.device.id };
  }
}
