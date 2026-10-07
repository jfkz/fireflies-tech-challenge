'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { VersionTag } from '@/components/app/UpdatePrompt';
import { Logo } from '@/components/brand/Logo';
import { useAuth } from '@/components/providers/AuthProvider';
import { useMe } from '@/hooks/queries';

const LINKS = [
  { href: '/meetings', label: 'Meetings' },
  { href: '/tasks', label: 'Tasks' },
  { href: '/people', label: 'People' },
  { href: '/calendar', label: 'Calendar' },
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
        <nav aria-label="App" className="flex justify-around overflow-x-auto border-t-2 border-ink/10 px-1 py-1 sm:hidden">
          {LINKS.map((l) => (
            <NavLink key={l.href} {...l} active={pathname.startsWith(l.href)} compact />
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6 sm:py-10">{children}</main>
      <footer className="mx-auto max-w-[1200px] px-4 pb-6 text-right sm:px-6">
        <VersionTag className="text-ink-soft/70" />
      </footer>
    </div>
  );
}

function NavLink({ href, label, active, compact = false }: { href: string; label: string; active: boolean; compact?: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`shrink-0 rounded-full py-1.5 font-extrabold transition-colors ${compact ? 'px-2.5 text-[0.8rem]' : 'px-3.5 text-sm'} ${active ? 'bg-ink text-white' : 'text-ink hover:bg-ink/5'}`}
    >
      {label}
    </Link>
  );
}
