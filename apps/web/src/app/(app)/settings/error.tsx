'use client';

import { RouteError } from '@/components/ui/RouteError';

export default function SettingsError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteError {...props} title="Settings didn’t load" />;
}
