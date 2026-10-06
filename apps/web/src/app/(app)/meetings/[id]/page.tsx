import type { Metadata } from 'next';
import { Suspense } from 'react';
import { MeetingView } from '@/components/app/MeetingView';

export const metadata: Metadata = { title: 'Meeting' };

export default async function MeetingPage({ params }: PageProps<'/meetings/[id]'>) {
  const { id } = await params;
  // MeetingView reads ?q= and ?t= (opened from a search result).
  return (
    <Suspense>
      <MeetingView id={id} />
    </Suspense>
  );
}
