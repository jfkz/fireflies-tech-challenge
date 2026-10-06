import type { Metadata } from 'next';
import { RecordView } from '@/components/app/RecordView';

export const metadata: Metadata = { title: 'New recording' };

export default function RecordPage() {
  return <RecordView />;
}
