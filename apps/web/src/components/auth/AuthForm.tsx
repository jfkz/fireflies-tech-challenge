'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { authErrorMessage, safeNext } from '@/lib/auth-errors';
import { useAuthMood } from './AuthMood';

type Mode = 'signin' | 'signup';

const COPY: Record<Mode, { title: string; lead: string; submit: string; busy: string }> = {
  signin: { title: 'Welcome back', lead: 'Your meetings are summarized and waiting. Nobody had to stay awake.', submit: 'Sign in', busy: 'Signing in…' },
  signup: {
    title: 'Create your account',
    lead: 'A demo meeting with its summary is waiting inside, so you can see what you get before recording anything.',
    submit: 'Create account',
    busy: 'Creating your account…',
  },
};

export function AuthForm({ mode }: { mode: Mode }) {
  const auth = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const { poke } = useAuthMood();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const emailId = useId();
  const passwordId = useId();
  const errorId = useId();
  const copy = COPY[mode];

  // Already signed in (or just finished): go where we were headed.
  useEffect(() => {
    if (!auth.loading && auth.user) router.replace(next);
  }, [auth.loading, auth.user, next, router]);

  async function run(action: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await action();
      poke('yay');
    } catch (err) {
      setError(authErrorMessage(err));
      poke('oops');
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void run(() => (mode === 'signin' ? auth.signIn(email.trim(), password) : auth.signUp(email.trim(), password)));
  }

  const otherHref = `${mode === 'signin' ? '/signup' : '/signin'}${params.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`;

  return (
    <div>
      <h1 className="font-display text-4xl leading-none sm:text-5xl">{copy.title}</h1>
      <p className="mt-3 font-semibold text-ink-soft">{copy.lead}</p>

      <button type="button" className="btn btn-secondary mt-7 w-full" onClick={() => run(auth.signInWithGoogle)} disabled={busy}>
        <GoogleGlyph /> Continue with Google
      </button>
      <div className="my-5 flex items-center gap-3 text-sm font-extrabold text-ink-soft" aria-hidden>
        <span className="h-0.5 flex-1 bg-ink/15" /> or with email <span className="h-0.5 flex-1 bg-ink/15" />
      </div>

      <form onSubmit={onSubmit} noValidate={false} aria-describedby={error ? errorId : undefined}>
        <div className="space-y-4">
          <div>
            <label htmlFor={emailId} className="label">
              Email
            </label>
            <input
              id={emailId}
              type="email"
              autoComplete="email"
              required
              className="field"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                poke('awake');
              }}
              onFocus={() => poke('awake')}
              placeholder="you@company.com"
            />
          </div>
          <div>
            <div className="flex items-baseline justify-between">
              <label htmlFor={passwordId} className="label">
                Password
              </label>
              {mode === 'signin' && (
                <Link href={`/reset${email ? `?email=${encodeURIComponent(email)}` : ''}`} className="text-sm font-extrabold text-call-deep underline-offset-2 hover:underline">
                  Forgot it?
                </Link>
              )}
            </div>
            <input
              id={passwordId}
              type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              required
              minLength={6}
              className="field"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                poke('shy');
              }}
              onFocus={() => poke('shy')}
              aria-describedby={mode === 'signup' ? `${passwordId}-hint` : undefined}
            />
            {mode === 'signup' && (
              <p id={`${passwordId}-hint`} className="mt-1.5 text-sm font-semibold text-ink-soft">
                At least 6 characters.
              </p>
            )}
          </div>
        </div>
        {error && (
          <p id={errorId} role="alert" className="mt-4 rounded-xl bg-danger-soft px-3 py-2 font-bold text-danger">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary btn-lg mt-6 w-full" disabled={busy}>
          {busy ? copy.busy : copy.submit}
        </button>
      </form>

      <p className="mt-6 text-center font-semibold text-ink-soft">
        {mode === 'signin' ? 'New here? ' : 'Already have an account? '}
        <Link href={otherHref} className="font-extrabold text-call-deep underline underline-offset-2">
          {mode === 'signin' ? 'Create an account' : 'Sign in'}
        </Link>
      </p>
    </div>
  );
}

export function ResetForm() {
  const auth = useAuth();
  const params = useSearchParams();
  const { poke } = useAuthMood();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [state, setState] = useState<{ kind: 'idle' | 'busy' | 'sent' } | { kind: 'error'; message: string }>({ kind: 'idle' });
  const id = useId();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setState({ kind: 'busy' });
    try {
      await auth.resetPassword(email.trim());
      setState({ kind: 'sent' });
      poke('yay');
    } catch (err) {
      setState({ kind: 'error', message: authErrorMessage(err) });
      poke('oops');
    }
  }

  return (
    <div>
      <h1 className="font-display text-4xl leading-none sm:text-5xl">Reset your password</h1>
      <p className="mt-3 font-semibold text-ink-soft">Enter your email and we’ll send a link to choose a new one.</p>
      {state.kind === 'sent' ? (
        <div role="status" className="mt-7 rounded-2xl border-2 border-ink bg-mint-soft p-4 font-bold">
          If there’s an account for {email}, a reset link is on its way. Check your inbox (and the spam folder, where the fun emails live).
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-7">
          <label htmlFor={id} className="label">
            Email
          </label>
          <input
            id={id}
            type="email"
            autoComplete="email"
            required
            className="field"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              poke('awake');
            }}
          />
          {state.kind === 'error' && (
            <p role="alert" className="mt-4 rounded-xl bg-danger-soft px-3 py-2 font-bold text-danger">
              {state.message}
            </p>
          )}
          <button type="submit" className="btn btn-primary btn-lg mt-6 w-full" disabled={state.kind === 'busy'}>
            {state.kind === 'busy' ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
      )}
      <p className="mt-6 text-center font-semibold text-ink-soft">
        <Link href="/signin" className="font-extrabold text-call-deep underline underline-offset-2">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
