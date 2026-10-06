'use client';

import { RouteError } from '@/components/ui/RouteError';

export default function RootError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="min-h-svh bg-paper px-4 py-10">
      <RouteError {...props} />
    </div>
  );
}
