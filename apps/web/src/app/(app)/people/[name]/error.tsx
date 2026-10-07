'use client';

import { RouteError } from '@/components/ui/RouteError';

export default function PersonError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteError {...props} title="This person didn’t load" />;
}
