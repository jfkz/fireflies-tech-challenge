'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { ErrorNote } from '@/components/ui/ErrorNote';
import { useMe } from '@/hooks/queries';

const TABS = [
  { href: '/admin', label: 'Overview', exact: true },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/reports', label: 'Reports' },
  { href: '/admin/settings', label: 'Settings' },
] as const;

/** The admin area: its tabs, and nothing else for anyone who isn't an admin. */
export function AdminFrame({ children }: { children: ReactNode }) {
  const me = useMe();
  const pathname = usePathname();
  if (me.isError) return <ErrorNote onRetry={() => me.refetch()}>{me.error.message}</ErrorNote>;
  if (me.isSuccess && !me.data.isAdmin) return <AdminsOnly />;
  return (
    <div>
      <nav aria-label="Admin" className="mb-6 flex flex-wrap gap-1.5">
        {TABS.map((t) => {
          const active = 'exact' in t ? pathname === t.href : pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? 'page' : undefined}
              className={`rounded-full border-2 border-ink px-3.5 py-1 text-sm font-extrabold ${active ? 'bg-sun' : 'bg-white hover:bg-paper'}`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
      {me.isSuccess ? children : <div className="sticker h-64 animate-pulse" aria-busy="true" aria-label="Loading" />}
    </div>
  );
}

export function AdminsOnly() {
  return (
    <p className="sticker px-6 py-10 text-center font-bold text-ink-soft" role="status">
      Only admins can see this.
    </p>
  );
}
