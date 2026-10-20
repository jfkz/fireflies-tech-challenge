import type { Metadata } from 'next';
import { AdminSettingsView } from '@/components/app/admin/AdminSettingsView';

export const metadata: Metadata = { title: 'Admin settings' };

export default function Page() {
  return <AdminSettingsView />;
}
