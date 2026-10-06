import type { Metadata } from 'next';
import { MeetingsList } from '@/components/app/MeetingsList';

export const metadata: Metadata = { title: 'Meetings' };

export default function MeetingsPage() {
  return <MeetingsList />;
}
