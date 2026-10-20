import { Injectable } from '@nestjs/common';
import { DEVICE_TOKEN_PREFIX, parseDeviceUserAgent } from '@boringtalks/shared';
import { randomToken, sha256Hex } from '../common/crypto';
import type { UserRow } from '../db/schema';
import { DevicesRepository } from './devices.repository';

const TOUCH_INTERVAL_MS = 60_000;

/** Long-lived desktop app tokens: `btd_` + 32 random bytes; only the sha256 is stored. */
@Injectable()
export class DeviceTokensService {
  constructor(private readonly repo: DevicesRepository) {}

  issue(): { token: string; tokenHash: string } {
    const token = `${DEVICE_TOKEN_PREFIX}${randomToken(32)}`;
    return { token, tokenHash: sha256Hex(token) };
  }

  /** The device's user, keeping when it was last seen (to the minute) and which app version it runs. */
  async authenticate(token: string, userAgent?: string): Promise<{ user: UserRow; deviceId: string } | null> {
    const found = await this.repo.findActiveByTokenHash(sha256Hex(token));
    if (!found) return null;
    const { device } = found;
    const app = parseDeviceUserAgent(userAgent);
    const changed = app !== null && (app.platform !== device.platform || app.version !== device.appVersion);
    const last = device.lastSeenAt?.getTime() ?? 0;
    if (changed || Date.now() - last > TOUCH_INTERVAL_MS) await this.repo.touch(device.id, app ?? undefined);
    return { user: found.user, deviceId: device.id };
  }
}
