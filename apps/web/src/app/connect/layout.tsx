import type { Metadata } from 'next';
import { RequireAuth } from '@/components/app/RequireAuth';
import { Logo } from '@/components/brand/Logo';

export const metadata: Metadata = { title: 'Connect your Mac', robots: { index: false, follow: false } };

export default function ConnectLayout({ children }: LayoutProps<'/connect'>) {
  return (
    <RequireAuth>
      <div className="min-h-svh bg-call px-4 py-5 sm:px-8">
        <Logo tone="white" href="/meetings" />
        <main className="py-8">{children}</main>
      </div>
    </RequireAuth>
  );
}
