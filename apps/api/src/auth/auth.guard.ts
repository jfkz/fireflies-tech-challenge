import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DEVICE_TOKEN_PREFIX } from '@boringtalks/shared';
import type { Request } from 'express';
import { DeviceTokensService } from '../devices/device-tokens.service';
import { UsersService } from '../users/users.service';
import { FIREBASE_ONLY, IS_PUBLIC, type AuthedRequest } from './auth.decorators';
import { FirebaseVerifier, InvalidTokenError } from './firebase-verifier';

/** Global guard: accepts a Firebase ID token or a `btd_` device token as a Bearer token. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly firebase: FirebaseVerifier,
    private readonly users: UsersService,
    private readonly deviceTokens: DeviceTokensService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<Request & AuthedRequest>();
    const token = bearer(req.headers.authorization);
    if (!token) throw new UnauthorizedException('Missing bearer token');

    if (token.startsWith(DEVICE_TOKEN_PREFIX)) {
      if (this.reflector.getAllAndOverride<boolean>(FIREBASE_ONLY, targets)) {
        throw new ForbiddenException('This action needs a dashboard sign-in');
      }
      const found = await this.deviceTokens.authenticate(token);
      if (!found) throw new UnauthorizedException('Invalid or revoked device token');
      req.auth = { user: found.user, via: 'device', deviceId: found.deviceId };
      return true;
    }

    try {
      const identity = await this.firebase.verify(token);
      req.auth = { user: await this.users.ensureUser(identity), via: 'firebase', deviceId: null };
      return true;
    } catch (err) {
      if (err instanceof InvalidTokenError) throw new UnauthorizedException('Invalid token');
      throw err;
    }
  }
}

function bearer(header: string | undefined): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  return match ? match[1] : null;
}
