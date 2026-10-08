import { AuthorizeDeviceRequest, DEVICE_CALLBACK_URLS, type DeviceApp } from '@boringtalks/shared';

export type ConnectParams =
  | { ok: true; challenge: string; deviceName: string; app: DeviceApp }
  | { ok: false; reason: 'missing' | 'invalid' };

const challengeSchema = AuthorizeDeviceRequest.shape.codeChallenge;

/**
 * Reads `/connect?challenge=…&device=…[&app=dev]` as opened by the Mac app. The challenge
 * must be a PKCE value; the device name is cleaned up and defaults to "your Mac"; `app=dev`
 * is BoringTalks Dev, anything else the release app.
 */
export function parseConnectParams(params: { get(name: string): string | null }): ConnectParams {
  const challenge = params.get('challenge')?.trim();
  if (!challenge) return { ok: false, reason: 'missing' };
  if (!challengeSchema.safeParse(challenge).success) return { ok: false, reason: 'invalid' };
  const raw = (params.get('device') ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  const deviceName = raw ? raw.slice(0, 80) : 'your Mac';
  const app: DeviceApp = params.get('app') === 'dev' ? 'dev' : 'release';
  return { ok: true, challenge, deviceName, app };
}

/** Where to send the app when the person declines; the app handles `?error=`. */
export function declinedCallbackUrl(app: DeviceApp = 'release'): string {
  return `${DEVICE_CALLBACK_URLS[app]}?error=access_denied`;
}

/** The apps' callback URLs are the only places a redirect may go. */
export function isAppCallback(url: string): boolean {
  return Object.values(DEVICE_CALLBACK_URLS).some((callback) => url.startsWith(`${callback}?`) || url === callback);
}
