import { Injectable, Logger } from '@nestjs/common';
import { effectiveRecordingLimit, type Me, type UpdateSettingsRequest } from '@boringtalks/shared';
import { AppSettingsService } from '../app-settings/app-settings.service';
import type { FirebaseIdentity } from '../auth/firebase-verifier';
import { AppConfig } from '../config/config.module';
import type { UserRow } from '../db/schema';
import { DemoService } from '../meetings/demo.service';
import { MeetingsRepository } from '../meetings/meetings.repository';
import { firstName } from '../processing/speaker-names';
import { JobsService } from '../queues/jobs.service';
import { UsersRepository } from './users.repository';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly config: AppConfig,
    private readonly repo: UsersRepository,
    private readonly demo: DemoService,
    private readonly jobs: JobsService,
    private readonly meetings: MeetingsRepository,
    private readonly settings: AppSettingsService,
  ) {}

  /**
   * Returns the user behind a Firebase identity, creating it on first sight.
   * A new user gets a ready demo meeting and a welcome email.
   */
  async ensureUser(identity: FirebaseIdentity): Promise<UserRow> {
    const existing = await this.repo.findByFirebaseUid(identity.uid);
    if (existing) {
      // A name the user typed in settings wins over the sign-in provider's.
      const name = existing.nameLocked ? existing.name : (identity.name ?? existing.name);
      const changed = (identity.email && identity.email !== existing.email) || name !== existing.name;
      if (!changed) return existing;
      return this.repo.updateProfile(existing.id, { email: identity.email ?? existing.email, name });
    }

    const created = await this.repo.insertIfAbsent({ firebaseUid: identity.uid, email: identity.email, name: identity.name });
    if (!created) {
      // Lost a race with a parallel first request; that one seeds the account.
      const winner = await this.repo.findByFirebaseUid(identity.uid);
      if (!winner) throw new Error('User vanished right after creation');
      return winner;
    }
    this.logger.log({ userId: created.id }, 'new user');
    await this.demo.seed(created.id, new Date(), created.name);
    await this.jobs.email({ type: 'welcome', userId: created.id });
    return created;
  }

  findById(id: string): Promise<UserRow | null> {
    return this.repo.findById(id);
  }

  async updateSettings(user: UserRow, body: UpdateSettingsRequest): Promise<Me> {
    const updated = await this.repo.updateSettings(user.id, {
      emailOnReady: body.emailOnReady,
      ...(body.name !== undefined ? { name: body.name, nameLocked: true } : {}),
    });
    // Past meetings follow: "You" becomes the new first name everywhere it wasn't set by hand.
    const before = firstName(user.name);
    const after = firstName(updated.name);
    if (after && after !== before) await this.meetings.renameOwner(user.id, after);
    return this.me(updated);
  }

  async me(user: UserRow): Promise<Me> {
    const limit = effectiveRecordingLimit(user.recordingLimitMinutes, await this.settings.recordingLimitMinutes());
    return {
      ...toMe(user, this.config.isAdmin(user)),
      isOwner: this.config.isOwner(user.email),
      recordingLimitSec: limit === null ? null : limit * 60,
    };
  }

  /** Keeps when the user was last active, to the minute. */
  async touch(user: UserRow): Promise<void> {
    const last = user.lastActiveAt?.getTime() ?? 0;
    if (Date.now() - last > 60_000) await this.repo.touchActive(user.id);
  }
}

export function toMe(user: UserRow, isAdmin = false): Me {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailOnReady: user.emailOnReady,
    createdAt: user.createdAt.toISOString(),
    isAdmin,
  };
}
