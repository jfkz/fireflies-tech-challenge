'use client';

import { formatDuration, type MeetingListItem } from '@boringtalks/shared';
import Link from 'next/link';
import { useState } from 'react';
import { Avatar } from '@/components/avatar/Avatar';
import { SpeechBubble } from '@/components/avatar/SpeechBubble';
import { ErrorNote } from '@/components/ui/ErrorNote';
import { SpeakerChip } from '@/components/ui/SpeakerChip';
import { StatusChip } from '@/components/ui/StatusChip';
import { useMe, useMeetings } from '@/hooks/queries';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { stillPose } from '@/lib/avatar/pose';
import { LISTENER } from '@/lib/avatar/styles';
import { formatMeetingDate } from '@/lib/format';

export function MeetingsList() {
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search.trim(), 300);
  const me = useMe();
  const list = useMeetings(q, me.isSuccess);
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const searching = q !== '';
  const loadFailed = list.isError && !list.data;
  const moreFailed = list.isFetchNextPageError;

  return (
    <div>
      <div className="flex flex-wrap items-end gap-4">
        <h1 className="font-display mr-auto text-4xl leading-none sm:text-5xl">Meetings</h1>
        <form role="search" onSubmit={(e) => e.preventDefault()} className="w-full sm:w-80">
          <label htmlFor="meeting-search" className="sr-only">
            Search meetings
          </label>
          <div className="relative">
            <svg viewBox="0 0 24 24" className="pointer-events-none absolute top-1/2 left-3.5 h-5 w-5 -translate-y-1/2 text-ink-soft" aria-hidden>
              <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2.6" />
              <path d="M15.5 15.5L20 20" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
            </svg>
            <input
              id="meeting-search"
              type="search"
              className="field pl-11"
              placeholder="Search titles and transcripts"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoComplete="off"
            />
          </div>
        </form>
      </div>

      <div className="mt-6">
        {me.isError ? (
          <ErrorNote onRetry={() => me.refetch()}>{me.error.message}</ErrorNote>
        ) : loadFailed ? (
          <ErrorNote onRetry={() => list.refetch()}>{list.error?.message ?? 'Could not load meetings.'}</ErrorNote>
        ) : list.isPending ? (
          <ListSkeleton />
        ) : items.length === 0 ? (
          searching ? <NoResults q={q} /> : <EmptyState />
        ) : (
          <>
            <ul className="sticker divide-y-2 divide-ink/10 overflow-hidden" aria-label="Meetings" aria-busy={list.isFetching}>
              {items.map((m) => (
                <MeetingRow key={m.id} meeting={m} />
              ))}
            </ul>
            {list.hasNextPage && (
              <div className="mt-6 flex justify-center">
                <button type="button" className="btn btn-secondary" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage}>
                  {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
            {moreFailed && (
              <div className="mt-4">
                <ErrorNote onRetry={() => list.fetchNextPage()}>{list.error?.message ?? 'Could not load more meetings.'}</ErrorNote>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function MeetingRow({ meeting: m }: { meeting: MeetingListItem }) {
  return (
    <li>
      <Link href={`/meetings/${m.id}`} className="group flex flex-col gap-2 px-5 py-4 transition-colors hover:bg-sun-soft/60 focus-visible:bg-sun-soft sm:flex-row sm:items-start sm:gap-6 sm:px-6">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-ink-soft">
            <time dateTime={m.startedAt}>{formatMeetingDate(m.startedAt)}</time>
            <span aria-hidden>, </span>
            {formatDuration(m.durationSec)}
            {m.source === 'demo' && <span className="ml-2 rounded-full bg-call-light px-2 py-0.5 text-xs font-extrabold text-ink">Demo</span>}
          </p>
          <h2 className="mt-1 text-lg leading-snug font-extrabold text-ink group-hover:underline group-hover:decoration-2 group-hover:underline-offset-4 sm:text-xl">
            {m.title}
          </h2>
          {m.description && <p className="mt-1 line-clamp-2 leading-relaxed font-semibold text-ink-soft">{m.description}</p>}
          {m.speakers.length > 0 && (
            <ul className="mt-2.5 flex flex-wrap gap-1.5" aria-label="Speakers">
              {m.speakers.slice(0, 6).map((s) => (
                <li key={s}>
                  <SpeakerChip name={s} />
                </li>
              ))}
              {m.speakers.length > 6 && <li className="self-center text-xs font-extrabold text-ink-soft">+{m.speakers.length - 6} more</li>}
            </ul>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end">
          <StatusChip status={m.status} />
          {m.actionItemCount > 0 && (
            <span className="text-sm font-extrabold text-ink-soft">
              {m.actionItemCount} action item{m.actionItemCount === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </Link>
    </li>
  );
}

function ListSkeleton() {
  return (
    <div className="sticker divide-y-2 divide-ink/10" aria-busy="true" aria-label="Loading meetings">
      {[0, 1, 2].map((i) => (
        <div key={i} className="px-6 py-5">
          <div className="h-3.5 w-40 animate-pulse rounded-full bg-paper" />
          <div className="mt-3 h-5 w-3/4 animate-pulse rounded-full bg-call-light/60" />
          <div className="mt-2.5 h-3.5 w-1/2 animate-pulse rounded-full bg-paper" />
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="sticker flex flex-col items-center px-6 py-12 text-center">
      <div className="relative">
        <div className="absolute bottom-[86%] left-[55%] w-max">
          <SpeechBubble>Your calendar must be suspiciously free.</SpeechBubble>
        </div>
        <Avatar style={LISTENER} pose={stillPose({ emotion: 'surprised' })} className="h-36 w-36" />
      </div>
      <h2 className="font-display mt-4 text-3xl">No meetings yet</h2>
      <p className="mt-2 max-w-[46ch] font-semibold text-ink-soft">
        Record one with the Mac app, or right here in the browser. You can also upload an audio file you already have.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link href="/record" className="btn btn-primary">
          Record in the browser
        </Link>
        <Link href="/#download" className="btn btn-secondary">
          Get the Mac app
        </Link>
      </div>
    </div>
  );
}

function NoResults({ q }: { q: string }) {
  return (
    <div className="sticker px-6 py-10 text-center" role="status">
      <Avatar style={LISTENER} pose={stillPose({ emotion: 'sad' })} className="mx-auto h-24 w-24" />
      <p className="mt-3 text-lg font-extrabold">Nothing matches “{q}”.</p>
      <p className="mt-1 font-semibold text-ink-soft">Search looks at titles, summaries and everything anyone said. Try another word.</p>
    </div>
  );
}
