import type { Metadata } from 'next';
import { ReportsView } from '@/components/app/ReportsView';

export const metadata: Metadata = { title: 'Problem reports' };

export default function ReportsPage() {
  return <ReportsView />;
}
