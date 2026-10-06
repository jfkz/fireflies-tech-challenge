import { AuthorizeDeviceRequest, DEVICE_CALLBACK_URL } from '@boringtalks/shared';

export type ConnectParams =
  | { ok: true; challenge: string; deviceName: string }
  | { ok: false; reason: 'missing' | 'invalid' };

const challengeSchema = AuthorizeDeviceRequest.shape.codeChallenge;

/**
 * Reads `/connect?challenge=…&device=…` as opened by the Mac app. The challenge
 * must be a PKCE value; the device name is cleaned up and defaults to "your Mac".
 */
export function parseConnectParams(params: { get(name: string): string | null }): ConnectParams {
  const challenge = params.get('challenge')?.trim();
  if (!challenge) return { ok: false, reason: 'missing' };
  if (!challengeSchema.safeParse(challenge).success) return { ok: false, reason: 'invalid' };
  const raw = (params.get('device') ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  const deviceName = raw ? raw.slice(0, 80) : 'your Mac';
  return { ok: true, challenge, deviceName };
}

/** Where to send the app when the person declines; the app handles `?error=`. */
export const DECLINED_CALLBACK_URL = `${DEVICE_CALLBACK_URL}?error=access_denied`;

/** The app's callback URL is the only place a redirect may go. */
export function isAppCallback(url: string): boolean {
  return url.startsWith(`${DEVICE_CALLBACK_URL}?`) || url === DEVICE_CALLBACK_URL;
}
