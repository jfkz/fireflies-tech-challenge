'use client';

import { useQueryClient } from '@tanstack/react-query';
import type { User } from 'firebase/auth';
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ApiClient } from '@/lib/api';
import { lazyApi } from '@/lib/lazy-api';

export interface AuthContextValue {
  user: User | null;
  /** True until Firebase has told us whether someone is signed in. */
  loading: boolean;
  /** The last sign-out was the user's own click (not an expired session). */
  signedOutByUser: boolean;
  api: ApiClient;
  /** Loads Firebase and starts listening for the signed-in user (idempotent). */
  start(): void;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<void>;
  signInWithGoogle(): Promise<void>;
  resetPassword(email: string): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// firebase/auth is loaded only in the browser and only on pages that use auth,
// so the landing page never downloads it.
const loadAuth = () => Promise.all([import('firebase/auth'), import('@/lib/firebase')]);

async function getToken(): Promise<string | null> {
  const [, { firebaseAuth }] = await loadAuth();
  const auth = firebaseAuth();
  await auth.authStateReady();
  return (await auth.currentUser?.getIdToken()) ?? null;
}

/** API client for public endpoints (no token). */
export const publicApi = lazyApi(() => import('@/lib/api-instance').then((m) => m.publicClient));
const api = lazyApi(() => import('@/lib/api-instance').then((m) => m.authedClient(getToken)));

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [signedOutByUser, setSignedOutByUser] = useState(false);
  const queryClient = useQueryClient();
  const started = useRef(false);
  const unsubscribe = useRef<() => void>(() => {});

  const start = useCallback(() => {
    if (started.current) return;
    started.current = true;
    let uid: string | null | undefined;
    loadAuth()
      .then(([{ onIdTokenChanged }, { firebaseAuth }]) => {
        unsubscribe.current = onIdTokenChanged(firebaseAuth(), (u) => {
          // Another account (or none): drop everything cached for the previous one.
          if (uid !== undefined && uid !== (u?.uid ?? null)) queryClient.clear();
          uid = u?.uid ?? null;
          if (u) setSignedOutByUser(false);
          setUser(u);
          setLoading(false);
        });
      })
      .catch((err) => {
        console.warn('[auth]', err instanceof Error ? err.message : err);
        setLoading(false);
      });
  }, [queryClient]);

  useEffect(() => () => unsubscribe.current(), []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      signedOutByUser,
      api,
      start,
      async signIn(email, password) {
        const [{ signInWithEmailAndPassword }, { firebaseAuth }] = await loadAuth();
        await signInWithEmailAndPassword(firebaseAuth(), email, password);
      },
      async signUp(email, password) {
        const [{ createUserWithEmailAndPassword }, { firebaseAuth }] = await loadAuth();
        await createUserWithEmailAndPassword(firebaseAuth(), email, password);
      },
      async signInWithGoogle() {
        const [{ GoogleAuthProvider, signInWithPopup }, { firebaseAuth }] = await loadAuth();
        await signInWithPopup(firebaseAuth(), new GoogleAuthProvider());
      },
      async resetPassword(email) {
        const [{ sendPasswordResetEmail }, { firebaseAuth }] = await loadAuth();
        await sendPasswordResetEmail(firebaseAuth(), email, { url: `${window.location.origin}/signin` });
      },
      async signOut() {
        const [{ signOut }, { firebaseAuth }] = await loadAuth();
        setSignedOutByUser(true);
        await signOut(firebaseAuth());
      },
    }),
    [user, loading, signedOutByUser, start],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}

/** The signed-in user and auth actions. Using it starts Firebase on this page. */
export function useAuth(): AuthContextValue {
  const ctx = use(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  const { start } = ctx;
  useEffect(() => start(), [start]);
  return ctx;
}

/** For tests: provide a ready-made auth value. */
export const AuthContextProvider = AuthContext;
