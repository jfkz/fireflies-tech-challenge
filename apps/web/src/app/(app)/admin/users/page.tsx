import type { Metadata } from 'next';
import { AdminUsersView } from '@/components/app/admin/AdminUsersView';

export const metadata: Metadata = { title: 'Users' };

export default function Page() {
  return <AdminUsersView />;
}
