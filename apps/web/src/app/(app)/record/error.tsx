'use client';

import { RouteError } from '@/components/ui/RouteError';

export default function RecordError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteError {...props} title="The recorder hit a snag" />;
}
