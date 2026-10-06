'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { TalkingHead } from '@/components/avatar/TalkingHead';
import { useAuth } from '@/components/providers/AuthProvider';
import { TALKER } from '@/lib/avatar/styles';

/** Where to send a signed-out visitor so they come back here afterwards. */
export function signInPath(pathname: string, search: string): string {
  const next = pathname + (search && search !== '?' ? (search.startsWith('?') ? search : `?${search}`) : '');
  return `/signin?next=${encodeURIComponent(next)}`;
}

/** Client-side guard for dashboard routes: redirects to /signin?next=… when signed out. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading, signedOutByUser } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading || user) return;
    // Signing out on purpose goes home; anything else asks to sign in and come back.
    router.replace(signedOutByUser ? '/' : signInPath(pathname, window.location.search));
  }, [loading, user, signedOutByUser, router, pathname]);

  if (!user) return <FullPageWait label={loading ? 'Checking who you are…' : 'Taking you to sign in…'} />;
  return <>{children}</>;
}

export function FullPageWait({ label }: { label: string }) {
  return (
    <div className="grid min-h-svh place-items-center bg-paper px-6" role="status" aria-live="polite">
      <div className="text-center">
        <TalkingHead style={TALKER} yawning className="mx-auto h-32 w-32" />
        <p className="mt-3 font-extrabold text-ink-soft">{label}</p>
      </div>
    </div>
  );
}
