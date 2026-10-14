'use client';

import { RouteError } from '@/components/ui/RouteError';

export default function ReportError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteError {...props} title="This report didn’t load" />;
}
