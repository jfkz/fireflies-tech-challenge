import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { AuthedRequest } from './auth.decorators';

/** Rate limits per signed-in user, falling back to the client IP. Runs after AuthGuard. */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    const auth = (req as AuthedRequest).auth;
    return Promise.resolve(auth ? `user:${auth.user.id}` : `ip:${String(req.ip)}`);
  }
}
