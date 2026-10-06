'use client';

import { RouteError } from '@/components/ui/RouteError';

export default function MeetingError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteError {...props} title="This meeting didn’t load" />;
}
