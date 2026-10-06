'use client';

import { RouteError } from '@/components/ui/RouteError';

export default function ConnectError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteError {...props} title="Connecting the Mac failed" />;
}
