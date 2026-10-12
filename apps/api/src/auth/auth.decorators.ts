import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { UserRow } from '../db/schema';

export const IS_PUBLIC = 'auth:public';
export const FIREBASE_ONLY = 'auth:firebase-only';

/** No credentials required. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Only a Firebase session (the dashboard) may call this, not a device token. */
export const FirebaseOnly = () => SetMetadata(FIREBASE_ONLY, true);

export interface AuthContext {
  user: UserRow;
  via: 'firebase' | 'device';
  deviceId: string | null;
}

export type AuthedRequest = { auth?: AuthContext };

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): UserRow => {
  const auth = ctx.switchToHttp().getRequest<AuthedRequest>().auth;
  if (!auth) throw new Error('CurrentUser used on a route without authentication');
  return auth.user;
});

/** The Mac that made the request, or null for the dashboard. */
export const CurrentDeviceId = createParamDecorator((_: unknown, ctx: ExecutionContext): string | null => {
  const auth = ctx.switchToHttp().getRequest<AuthedRequest>().auth;
  if (!auth) throw new Error('CurrentDeviceId used on a route without authentication');
  return auth.deviceId;
});
