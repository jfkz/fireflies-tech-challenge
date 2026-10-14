import type { Metadata } from 'next';
import { ReportView } from '@/components/app/ReportsView';

export const metadata: Metadata = { title: 'Problem report' };

export default async function ReportPage({ params }: PageProps<'/admin/reports/[id]'>) {
  const { id } = await params;
  return <ReportView id={id} />;
}
