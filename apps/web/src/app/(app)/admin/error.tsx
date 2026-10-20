'use client';

import { RouteError } from '@/components/ui/RouteError';

export default function AdminError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteError {...props} title="The overview didn’t load" />;
}
