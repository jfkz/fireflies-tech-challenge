'use client';

import { RouteError } from '@/components/ui/RouteError';

export default function ReportsError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteError {...props} title="Reports didn’t load" />;
}
