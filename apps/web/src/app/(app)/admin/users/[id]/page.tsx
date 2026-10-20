import type { Metadata } from 'next';
import { AdminUserView } from '@/components/app/admin/AdminUserView';

export const metadata: Metadata = { title: 'User' };

export default async function UserPage({ params }: PageProps<'/admin/users/[id]'>) {
  const { id } = await params;
  return <AdminUserView id={id} />;
}
