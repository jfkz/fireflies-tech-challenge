import { Suspense } from 'react';
import { ConnectView } from '@/components/app/ConnectView';

export default function ConnectPage() {
  return (
    <Suspense>
      <ConnectView />
    </Suspense>
  );
}
