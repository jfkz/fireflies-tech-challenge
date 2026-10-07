'use client';

import { RouteError } from '@/components/ui/RouteError';

export default function PeopleError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteError {...props} title="People didn’t load" />;
}
