import type { Metadata } from 'next';
import { MeetingView } from '@/components/app/MeetingView';

export const metadata: Metadata = { title: 'Meeting' };

export default async function MeetingPage({ params }: PageProps<'/meetings/[id]'>) {
  const { id } = await params;
  return <MeetingView id={id} />;
}
