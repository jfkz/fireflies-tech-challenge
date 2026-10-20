import type { ReactNode } from 'react';
import { AdminFrame } from '@/components/app/admin/AdminFrame';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminFrame>{children}</AdminFrame>;
}
