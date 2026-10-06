import type { Metadata } from 'next';
import { AppShell } from '@/components/app/AppShell';
import { RequireAuth } from '@/components/app/RequireAuth';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function DashboardLayout({ children }: LayoutProps<'/'>) {
  return (
    <RequireAuth>
      <AppShell>{children}</AppShell>
    </RequireAuth>
  );
}
