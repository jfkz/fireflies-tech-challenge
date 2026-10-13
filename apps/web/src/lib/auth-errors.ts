/** Turns Firebase Auth error codes into sentences that say what to do next. */
export function authErrorMessage(err: unknown): string {
  const code = (err as { code?: string } | null)?.code ?? '';
  switch (code) {
    case 'auth/invalid-email':
      return 'That email address doesn’t look right.';
    case 'auth/missing-password':
      return 'Enter your password.';
    case 'auth/weak-password':
      return 'Use at least 6 characters for the password.';
    case 'auth/email-already-in-use':
      return 'There is already an account with this email. Sign in instead.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-login-credentials':
      return 'Wrong email or password.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a minute, then try again.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'The Google window was closed before signing in finished.';
    case 'auth/popup-blocked':
      return 'The browser blocked the Google window. Allow pop-ups for this site and try again.';
    case 'auth/network-request-failed':
      return 'Could not reach the sign-in service. Check your connection.';
    case 'auth/unauthorized-domain':
      return 'Sign-in is not enabled for this domain yet.';
    case 'auth/expired-action-code':
      return 'This link has expired. Ask for a new one.';
    case 'auth/invalid-action-code':
      return 'This link was already used, or it’s incomplete. Ask for a new one.';
    case 'auth/user-disabled':
      return 'This account is disabled.';
    default:
      return err instanceof Error && err.message ? err.message : 'Something went wrong. Try again.';
  }
}

/** Our sites: where a reset link may send the person back to. */
const OWN_HOSTS = ['boringtalks.lol', 'dev.boringtalks.lol', 'localhost', '127.0.0.1'];

/**
 * The page a Firebase action link (`continueUrl`) should return to: a URL on one of our own sites
 * (the reset may have started on dev, while every link opens on boringtalks.lol), else null.
 */
export function safeContinue(url: string | null | undefined): URL | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const local = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) return null;
    return OWN_HOSTS.includes(parsed.hostname) && !parsed.username && !parsed.password ? parsed : null;
  } catch {
    return null;
  }
}

/** Only same-site paths may be used as the post-sign-in destination. */
export function safeNext(next: string | null | undefined, fallback = '/meetings'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  return next;
}
