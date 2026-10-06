'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { Avatar } from '@/components/avatar/Avatar';
import { stillPose } from '@/lib/avatar/pose';
import { LISTENER } from '@/lib/avatar/styles';

/** Shared body for error.tsx boundaries. */
export function RouteError({ error, retry, title = 'Something broke on this page' }: { error: Error & { digest?: string }; retry: () => void; title?: string }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="sticker mx-auto my-6 flex max-w-xl flex-col items-center px-6 py-12 text-center" role="alert">
      <Avatar style={LISTENER} pose={stillPose({ emotion: 'scared' })} className="h-28 w-28" />
      <h1 className="font-display mt-4 text-3xl">{title}</h1>
      <p className="mt-2 max-w-[44ch] font-semibold text-ink-soft">
        {error.message || 'An unexpected error happened.'} Try again, and if it keeps happening, reload the page.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button type="button" className="btn btn-primary" onClick={retry}>
          Try again
        </button>
        <Link href="/" className="btn btn-secondary">
          Go home
        </Link>
      </div>
    </div>
  );
}
