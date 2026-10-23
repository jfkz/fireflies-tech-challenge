'use client';

import type { Me } from '@boringtalks/shared';
import { useQueryClient } from '@tanstack/react-query';
import { usePathname } from 'next/navigation';
import { use, useEffect, useRef } from 'react';
import { analytics } from '@/lib/analytics';
import { AuthContextProvider } from './AuthProvider';

/**
 * Page views, and who is signed in: identified by the account id from GET /me (the id the API's
 * events use) as soon as it is loaded, forgotten on sign-out. Reads the auth context without
 * starting Firebase, so the landing page stays as light as it was. Does nothing without a key.
 */
export function Analytics() {
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const auth = use(AuthContextProvider);
  const identified = useRef<string | null>(null);

  useEffect(() => {
    analytics.pageview(window.location.href);
  }, [pathname]);

  useEffect(
    () =>
      queryClient.getQueryCache().subscribe(({ query }) => {
        if (query.queryKey[0] !== 'me') return;
        const me = query.state.data as Me | undefined;
        if (!me || identified.current === me.id) return;
        identified.current = me.id;
        analytics.identify(me.id, { isAdmin: me.isAdmin === true, createdAt: me.createdAt });
      }),
    [queryClient],
  );

  const signedOut = auth?.signedOutByUser ?? false;
  useEffect(() => {
    if (!signedOut || !identified.current) return;
    identified.current = null;
    analytics.reset();
  }, [signedOut]);

  return null;
}
