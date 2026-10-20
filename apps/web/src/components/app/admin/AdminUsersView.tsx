'use client';

import type { AdminUserSummary } from '@boringtalks/shared';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { ErrorNote } from '@/components/ui/ErrorNote';
import { useAdminUsers, useMe } from '@/hooks/queries';
import { appLabel, limitLabel, minutes } from '@/lib/admin';
import { formatMeetingDate } from '@/lib/format';

/** Every account, newest first, with how much they use BoringTalks. */
export function AdminUsersView() {
  const me = useMe();
  const [query, setQuery] = useState('');
  const [text, setText] = useState('');
  const users = useAdminUsers(query, me.data?.isAdmin === true);
  const items = users.data?.pages.flatMap((p) => p.items) ?? [];

  const search = (e: FormEvent) => {
    e.preventDefault();
    setQuery(text.trim());
  };

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <h1 className="font-display mr-auto text-4xl leading-none sm:text-5xl">Users</h1>
        <form onSubmit={search} role="search" className="flex w-full items-center gap-2 sm:w-auto">
          <input
            type="search"
            className="field min-w-0 flex-1 py-1.5 text-sm sm:w-72"
            placeholder="Email, name or user id"
            aria-label="Email, name or user id"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button type="submit" className="btn btn-secondary btn-sm">
            Search
          </button>
        </form>
      </div>

      <div className="mt-6 space-y-6">
        {users.isError && !users.data ? (
          <ErrorNote onRetry={() => users.refetch()}>{users.error.message}</ErrorNote>
        ) : users.isPending ? (
          <div className="sticker h-64 animate-pulse" aria-busy="true" aria-label="Loading users" />
        ) : items.length === 0 ? (
          <p className="sticker px-6 py-10 text-center font-bold text-ink-soft" role="status">
            {query ? 'Nobody matches.' : 'No users yet.'}
          </p>
        ) : (
          <ul className="sticker divide-y-2 divide-ink/10 overflow-hidden" aria-label="Users">
            {items.map((u) => (
              <UserRow key={u.id} user={u} />
            ))}
          </ul>
        )}
        {users.hasNextPage && (
          <div className="flex justify-center">
            <button type="button" className="btn btn-secondary" onClick={() => users.fetchNextPage()} disabled={users.isFetchingNextPage}>
              {users.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function UserRow({ user: u }: { user: AdminUserSummary }) {
  return (
    <li>
      <Link href={`/admin/users/${u.id}`} className="block px-5 py-3.5 hover:bg-paper">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-extrabold text-ink">{u.email ?? u.id}</span>
          {u.name && <span className="text-sm font-bold text-ink-soft">{u.name}</span>}
          <Badges user={u} />
          <span className="ml-auto text-xs font-bold text-ink-soft">
            {u.lastActiveAt ? `Active ${formatMeetingDate(u.lastActiveAt)}` : 'Never active'}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs font-bold text-ink-soft">
          <span>
            {u.meetingCount} {u.meetingCount === 1 ? 'meeting' : 'meetings'}, {minutes(u.recordedMinutes)}
          </span>
          <span>Joined {formatMeetingDate(u.createdAt)}</span>
          {u.apps.length > 0 && <span>{u.apps.map((a) => appLabel(a.platform, a.version)).join(', ')}</span>}
        </div>
      </Link>
    </li>
  );
}

export function Badges({ user: u }: { user: Pick<AdminUserSummary, 'isAdmin' | 'isOwner' | 'recordingLimitMinutes'> }) {
  return (
    <>
      {u.isOwner ? (
        <span className="rounded-full bg-ink px-2 py-0.5 text-xs font-extrabold text-white">owner</span>
      ) : (
        u.isAdmin && <span className="rounded-full bg-sun px-2 py-0.5 text-xs font-extrabold text-ink">admin</span>
      )}
      {u.recordingLimitMinutes !== null && (
        <span className="rounded-full bg-paper px-2 py-0.5 text-xs font-extrabold text-ink">limit: {limitLabel(u.recordingLimitMinutes)}</span>
      )}
    </>
  );
}
