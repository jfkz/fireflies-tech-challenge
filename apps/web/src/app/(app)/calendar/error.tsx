'use client';

import { RouteError } from '@/components/ui/RouteError';

export default function CalendarError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteError {...props} title="The calendar didn’t load" />;
}
