import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PeopleSkeleton, PeopleView } from '@/components/app/PeopleView';

export const metadata: Metadata = { title: 'People' };

export default function PeoplePage() {
  // The period lives in the URL (?days=), read with useSearchParams on the client.
  return (
    <Suspense fallback={<PeopleSkeleton />}>
      <PeopleView />
    </Suspense>
  );
}
