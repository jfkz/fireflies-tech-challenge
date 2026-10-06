import { getApp, getApps, initializeApp, type FirebaseOptions } from 'firebase/app';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import { env } from './env';

let auth: Auth | null = null;

export function firebaseOptions(): FirebaseOptions {
  const { apiKey, authDomain, projectId, appId, authEmulator } = env.firebase;
  if (!apiKey || !projectId) {
    if (authEmulator) return { apiKey: apiKey ?? 'demo-key', projectId: projectId ?? 'demo-boringtalks', authDomain: authDomain ?? 'localhost' };
    throw new Error('Firebase is not configured: set NEXT_PUBLIC_FIREBASE_API_KEY and NEXT_PUBLIC_FIREBASE_PROJECT_ID.');
  }
  return { apiKey, authDomain: ownAuthDomain(authDomain), projectId, appId };
}

/**
 * On the site's own domain, sign-in runs through `/__/auth/*` on that domain (next.config proxies it
 * to Firebase), so Google's account picker says "continue to boringtalks.lol" rather than the
 * Firebase project's *.firebaseapp.com host. Elsewhere (local, raw preview URLs) keep the default.
 */
export function ownAuthDomain(configured: string | undefined, location: Pick<Location, 'host' | 'hostname'> | undefined = globalThis.location): string | undefined {
  if (!location || !configured?.endsWith('.firebaseapp.com')) return configured;
  return location.hostname === new URL(env.siteUrl).hostname ? location.host : configured;
}

/** The Firebase Auth instance, created on first use in the browser only. */
export function firebaseAuth(): Auth {
  if (auth) return auth;
  const app = getApps().length ? getApp() : initializeApp(firebaseOptions());
  auth = getAuth(app);
  if (env.firebase.authEmulator) connectAuthEmulator(auth, env.firebase.authEmulator, { disableWarnings: true });
  return auth;
}
