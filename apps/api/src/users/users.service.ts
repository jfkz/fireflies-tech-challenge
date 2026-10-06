import { Injectable, Logger } from '@nestjs/common';
import type { Me, UpdateSettingsRequest } from '@boringtalks/shared';
import type { FirebaseIdentity } from '../auth/firebase-verifier';
import type { UserRow } from '../db/schema';
import { DemoService } from '../meetings/demo.service';
import { JobsService } from '../queues/jobs.service';
import { UsersRepository } from './users.repository';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly repo: UsersRepository,
    private readonly demo: DemoService,
    private readonly jobs: JobsService,
  ) {}

  /**
   * Returns the user behind a Firebase identity, creating it on first sight.
   * A new user gets a ready demo meeting and a welcome email.
   */
  async ensureUser(identity: FirebaseIdentity): Promise<UserRow> {
    const existing = await this.repo.findByFirebaseUid(identity.uid);
    if (existing) {
      const changed = (identity.email && identity.email !== existing.email) || (identity.name && identity.name !== existing.name);
      if (!changed) return existing;
      return this.repo.updateProfile(existing.id, {
        email: identity.email ?? existing.email,
        name: identity.name ?? existing.name,
      });
    }

    const created = await this.repo.insertIfAbsent({ firebaseUid: identity.uid, email: identity.email, name: identity.name });
    if (!created) {
      // Lost a race with a parallel first request; that one seeds the account.
      const winner = await this.repo.findByFirebaseUid(identity.uid);
      if (!winner) throw new Error('User vanished right after creation');
      return winner;
    }
    this.logger.log({ userId: created.id }, 'new user');
    await this.demo.seed(created.id);
    await this.jobs.email({ type: 'welcome', userId: created.id });
    return created;
  }

  findById(id: string): Promise<UserRow | null> {
    return this.repo.findById(id);
  }

  async updateSettings(user: UserRow, body: UpdateSettingsRequest): Promise<Me> {
    return toMe(await this.repo.updateSettings(user.id, { emailOnReady: body.emailOnReady }));
  }
}

export function toMe(user: UserRow): Me {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailOnReady: user.emailOnReady,
    createdAt: user.createdAt.toISOString(),
  };
}
