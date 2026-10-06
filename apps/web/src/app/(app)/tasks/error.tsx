'use client';

import { RouteError } from '@/components/ui/RouteError';

export default function TasksError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteError {...props} title="Tasks didn’t load" />;
}
