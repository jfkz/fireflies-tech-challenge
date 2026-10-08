import { z } from 'zod';

/** base64url without padding, 43–128 characters (RFC 7636). */
const pkceString = z.string().regex(/^[A-Za-z0-9\-._~]{43,128}$/, 'Not a PKCE value');

/** Which Mac app is signing in: the release app, or BoringTalks Dev (the dev environment's build). */
export const DeviceApp = z.enum(['release', 'dev']);
export type DeviceApp = z.infer<typeof DeviceApp>;

/** Sent by the dashboard (signed in with Firebase) to approve a Mac. */
export const AuthorizeDeviceRequest = z.object({
  codeChallenge: pkceString,
  deviceName: z.string().trim().min(1).max(80),
  /** Picks the URL scheme the code goes back on; the release app when left out. */
  app: DeviceApp.optional(),
});
export type AuthorizeDeviceRequest = z.infer<typeof AuthorizeDeviceRequest>;

export const AuthorizeDeviceResponse = z.object({
  code: z.string(),
  expiresInSec: z.number().int(),
  redirectUrl: z.string(),
});
export type AuthorizeDeviceResponse = z.infer<typeof AuthorizeDeviceResponse>;

/** Sent by the Mac app to swap the one-time code for its device token. */
export const DeviceTokenRequest = z.object({
  code: z.string().min(1),
  codeVerifier: pkceString,
});
export type DeviceTokenRequest = z.infer<typeof DeviceTokenRequest>;

export const DeviceTokenResponse = z.object({
  token: z.string(),
  deviceId: z.string().uuid(),
  user: z.object({ email: z.string().email().nullable(), name: z.string().nullable() }),
});
export type DeviceTokenResponse = z.infer<typeof DeviceTokenResponse>;

export const Device = z.object({
  id: z.string().uuid(),
  name: z.string(),
  createdAt: z.string().datetime(),
  lastSeenAt: z.string().datetime().nullable(),
});
export type Device = z.infer<typeof Device>;

/** Prefix that tells device tokens apart from Firebase ID tokens. */
export const DEVICE_TOKEN_PREFIX = 'btd_';

/** Sign-in callback of each Mac app: the URL scheme it registers. */
export const DEVICE_CALLBACK_URLS: Record<DeviceApp, string> = {
  release: 'boringtalks://callback',
  dev: 'boringtalks-dev://callback',
};
