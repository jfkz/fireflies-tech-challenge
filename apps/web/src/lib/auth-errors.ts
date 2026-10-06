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
    default:
      return err instanceof Error && err.message ? err.message : 'Something went wrong. Try again.';
  }
}

/** Only same-site paths may be used as the post-sign-in destination. */
export function safeNext(next: string | null | undefined, fallback = '/meetings'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  return next;
}
