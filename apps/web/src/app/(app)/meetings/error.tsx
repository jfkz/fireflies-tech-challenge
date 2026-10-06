'use client';

import { RouteError } from '@/components/ui/RouteError';

export default function MeetingsError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteError {...props} title="The meetings list fell over" />;
}
