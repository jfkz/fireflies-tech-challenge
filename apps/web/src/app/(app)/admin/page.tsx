import type { Metadata } from 'next';
import { AdminOverviewView } from '@/components/app/admin/AdminOverviewView';

export const metadata: Metadata = { title: 'Admin' };

export default function Page() {
  return <AdminOverviewView />;
}
