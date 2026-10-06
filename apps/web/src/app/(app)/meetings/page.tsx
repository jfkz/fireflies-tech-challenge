import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ListSkeleton, MeetingsList } from '@/components/app/MeetingsList';

export const metadata: Metadata = { title: 'Meetings' };

export default function MeetingsPage() {
  // The list reads its filters from the URL (useSearchParams), so it renders on the client.
  return (
    <Suspense fallback={<ListSkeleton />}>
      <MeetingsList />
    </Suspense>
  );
}
