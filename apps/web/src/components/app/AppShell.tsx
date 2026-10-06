'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Logo } from '@/components/brand/Logo';
import { useAuth } from '@/components/providers/AuthProvider';
import { useMe } from '@/hooks/queries';

const LINKS = [
  { href: '/meetings', label: 'Meetings' },
  { href: '/record', label: 'Record' },
  { href: '/settings', label: 'Settings' },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user } = useAuth();
  // The first GET /me creates the account (and its demo meeting) on the server.
  useMe();

  return (
    <div className="min-h-svh bg-paper">
      <header className="sticky top-0 z-40 border-b-[2.5px] border-ink bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1200px] items-center gap-3 px-4 py-2.5 sm:px-6">
          <Logo href="/meetings" />
          <nav aria-label="App" className="ml-2 hidden items-center gap-1 sm:flex">
            {LINKS.map((l) => (
              <NavLink key={l.href} {...l} active={pathname.startsWith(l.href)} />
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden max-w-[22ch] truncate text-sm font-bold text-ink-soft md:inline" title={user?.email ?? undefined}>
              {user?.email}
            </span>
            <Link href="/record" className="btn btn-primary btn-sm">
              New recording
            </Link>
          </div>
        </div>
        <nav aria-label="App" className="flex justify-around border-t-2 border-ink/10 px-2 py-1 sm:hidden">
          {LINKS.map((l) => (
            <NavLink key={l.href} {...l} active={pathname.startsWith(l.href)} />
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6 sm:py-10">{children}</main>
    </div>
  );
}

function NavLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`rounded-full px-3.5 py-1.5 text-sm font-extrabold transition-colors ${active ? 'bg-ink text-white' : 'text-ink hover:bg-ink/5'}`}
    >
      {label}
    </Link>
  );
}
