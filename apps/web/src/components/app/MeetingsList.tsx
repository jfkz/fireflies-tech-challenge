'use client';

import { formatDuration, formatTimestamp, type MeetingFacets, type MeetingListItem, type SearchMatch } from '@boringtalks/shared';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Avatar } from '@/components/avatar/Avatar';
import { SpeechBubble } from '@/components/avatar/SpeechBubble';
import { ErrorNote } from '@/components/ui/ErrorNote';
import { SpeakerChip } from '@/components/ui/SpeakerChip';
import { StatusChip } from '@/components/ui/StatusChip';
import { Marked } from '@/components/ui/Marked';
import { TopicPill } from '@/components/ui/TopicPill';
import { useMe, useMeetingFacets, useMeetings, type MeetingFilters } from '@/hooks/queries';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { stillPose } from '@/lib/avatar/pose';
import { LISTENER } from '@/lib/avatar/styles';
import { filtersFromParams, filtersToSearch, hasFilters } from '@/lib/filters';
import { formatMeetingDate } from '@/lib/format';
import { markedParts } from '@/lib/search';

export function MeetingsList() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const filters = filtersFromParams(params);
  const [search, setSearch] = useState(filters.q ?? '');
  const q = useDebouncedValue(search.trim(), 300);
  const me = useMe();
  const list = useMeetings({ ...filters, q }, me.isSuccess);
  const facets = useMeetingFacets(me.isSuccess);
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const filtered = hasFilters({ ...filters, q });
  const loadFailed = list.isError && !list.data;
  const moreFailed = list.isFetchNextPageError;

  // Typing replaces the URL (no history entry per keystroke); clicking a pill pushes one.
  useEffect(() => {
    if (q === (params.get('q') ?? '')) return;
    router.replace(`${pathname}${filtersToSearch({ ...filtersFromParams(params), q })}`, { scroll: false });
  }, [q, params, pathname, router]);

  const applyFilter = (next: MeetingFilters) => router.push(`${pathname}${filtersToSearch({ ...filters, q, ...next })}`, { scroll: false });
  const toggle = (key: 'speaker' | 'topic', value: string) => applyFilter({ [key]: filters[key] === value ? undefined : value });
  // "/" jumps to the search box from anywhere on the page, like most search UIs.
  const searchBox = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName));
      if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        searchBox.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const clear = () => {
    setSearch('');
    router.push(pathname, { scroll: false });
  };

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
              ref={searchBox}
              placeholder="Search notes, people and transcripts"
              title="Press / to search. Use quotes for a phrase and -word to leave a word out."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoComplete="off"
            />
          </div>
        </form>
      </div>

      <FilterBar facets={facets.data} filters={filters} onToggle={toggle} onClear={filtered ? clear : undefined} />

      <div className="mt-6">
        {me.isError ? (
          <ErrorNote onRetry={() => me.refetch()}>{me.error.message}</ErrorNote>
        ) : loadFailed ? (
          <ErrorNote onRetry={() => list.refetch()}>{list.error?.message ?? 'Could not load meetings.'}</ErrorNote>
        ) : list.isPending ? (
          <ListSkeleton />
        ) : items.length === 0 ? (
          filtered ? <NoResults filters={{ ...filters, q }} onClear={clear} /> : <EmptyState />
        ) : (
          <>
            <ul className="sticker divide-y-2 divide-ink/10 overflow-hidden" aria-label="Meetings" aria-busy={list.isFetching}>
              {items.map((m) => (
                <MeetingRow key={m.id} meeting={m} filters={filters} onToggle={toggle} q={q} />
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

type Toggle = (key: 'speaker' | 'topic', value: string) => void;

/** How many people and topics show before "more". */
const FACETS_SHOWN = 8;

/** People and topics to filter by, most frequent first; the active ones are highlighted. */
export function FilterBar({
  facets,
  filters,
  onToggle,
  onClear,
}: {
  facets: MeetingFacets | undefined;
  filters: MeetingFilters;
  onToggle: Toggle;
  onClear?: () => void;
}) {
  const [all, setAll] = useState(false);
  const pick = (values: string[], active: string | undefined) => {
    const shown = all ? values : values.slice(0, FACETS_SHOWN);
    // An active filter from a link stays visible even if it isn't among the most frequent.
    return active && !shown.includes(active) ? [active, ...shown] : shown;
  };
  const speakers = pick(facets?.speakers.map((f) => f.value) ?? [], filters.speaker);
  const topics = pick(facets?.topics.map((f) => f.value) ?? [], filters.topic);
  const more = !all && ((facets?.speakers.length ?? 0) > FACETS_SHOWN || (facets?.topics.length ?? 0) > FACETS_SHOWN);
  if (speakers.length === 0 && topics.length === 0 && !onClear) return null;

  return (
    <div className="mt-5 space-y-2" aria-label="Filters" role="group">
      {speakers.length > 0 && (
        <PillRow label="People">
          {speakers.map((s) => (
            <li key={s}>
              <button type="button" onClick={() => onToggle('speaker', s)} aria-pressed={filters.speaker === s} className="rounded-full" title={`Meetings with ${s}`}>
                <SpeakerChip name={s} active={filters.speaker === s} />
              </button>
            </li>
          ))}
        </PillRow>
      )}
      {topics.length > 0 && (
        <PillRow label="Topics">
          {topics.map((t) => (
            <li key={t}>
              <button type="button" onClick={() => onToggle('topic', t)} aria-pressed={filters.topic === t} className="rounded-full" title={`Meetings about ${t}`}>
                <TopicPill topic={t} active={filters.topic === t} />
              </button>
            </li>
          ))}
        </PillRow>
      )}
      <div className="flex gap-4">
        {more && (
          <button type="button" className="text-sm font-extrabold text-call-deep underline underline-offset-2" onClick={() => setAll(true)}>
            Show all people and topics
          </button>
        )}
        {onClear && (
          <button type="button" className="text-sm font-extrabold text-call-deep underline underline-offset-2" onClick={onClear}>
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}

function PillRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <span className="w-16 shrink-0 text-xs font-extrabold tracking-wide text-ink-soft uppercase">{label}</span>
      <ul className="flex flex-wrap gap-1.5" aria-label={label}>
        {children}
      </ul>
    </div>
  );
}

export function MeetingRow({ meeting: m, filters = {}, onToggle, q }: { meeting: MeetingListItem; filters?: MeetingFilters; onToggle?: Toggle; q?: string }) {
  return (
    <li className="group relative flex flex-col gap-2 px-5 py-4 transition-colors focus-within:bg-sun-soft hover:bg-sun-soft/60 sm:flex-row sm:items-start sm:gap-6 sm:px-6">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-ink-soft">
          <time dateTime={m.startedAt}>{formatMeetingDate(m.startedAt)}</time>
          <span aria-hidden>, </span>
          {formatDuration(m.durationSec)}
          {m.source === 'demo' && <span className="ml-2 rounded-full bg-call-light px-2 py-0.5 text-xs font-extrabold text-ink">Demo</span>}
        </p>
        <h2 className="mt-1 text-lg leading-snug font-extrabold text-ink sm:text-xl">
          {/* The whole row is the link (stretched); the pills below sit on top of it as their own buttons. */}
          <Link
            href={`/meetings/${m.id}`}
            className="outline-none after:absolute after:inset-0 group-hover:underline group-hover:decoration-2 group-hover:underline-offset-4"
          >
            {m.title}
          </Link>
        </h2>
        {m.description && <p className="mt-1 line-clamp-2 leading-relaxed font-semibold text-ink-soft">{m.description}</p>}
        {m.match && q && <MatchSnippet meetingId={m.id} match={m.match} q={q} />}
        {(m.speakers.length > 0 || m.topics.length > 0) && (
          <ul className="relative z-10 mt-2.5 flex flex-wrap items-center gap-1.5" aria-label="Speakers and topics">
            {m.speakers.slice(0, 6).map((s) => (
              <li key={`s:${s}`}>
                <Pill onClick={onToggle && (() => onToggle('speaker', s))} pressed={filters.speaker === s} title={`Meetings with ${s}`}>
                  <SpeakerChip name={s} active={filters.speaker === s} />
                </Pill>
              </li>
            ))}
            {m.speakers.length > 6 && <li className="self-center text-xs font-extrabold text-ink-soft">+{m.speakers.length - 6} more</li>}
            {m.topics.map((t) => (
              <li key={`t:${t}`}>
                <Pill onClick={onToggle && (() => onToggle('topic', t))} pressed={filters.topic === t} title={`Meetings about ${t}`}>
                  <TopicPill topic={t} active={filters.topic === t} />
                </Pill>
              </li>
            ))}
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
    </li>
  );
}

/** Why a meeting is in the search results; a transcript hit links straight to that moment. */
function MatchSnippet({ meetingId, match, q }: { meetingId: string; match: SearchMatch; q: string }) {
  const where = { transcript: 'Said', notes: 'In the notes', title: 'In the title', people: 'People and topics' }[match.in];
  const href = `/meetings/${meetingId}?${new URLSearchParams({ q, ...(match.startMs !== null ? { t: String(match.startMs) } : {}) })}`;
  return (
    <Link
      href={href}
      className="relative z-10 mt-2 block rounded-xl border-2 border-ink/10 bg-white px-3 py-2 text-sm leading-relaxed font-semibold text-ink hover:border-ink/40"
      data-testid="search-match"
    >
      <span className="mb-0.5 flex flex-wrap items-center gap-x-2 text-xs font-extrabold text-ink-soft">
        {where}
        {match.speaker && <span className="text-ink">{match.speaker}</span>}
        {match.startMs !== null && <span className="tabular-nums">{formatTimestamp(match.startMs)}</span>}
        {match.hits > 1 && <span>· {match.hits} mentions</span>}
      </span>
      <span className="line-clamp-2">
        {match.in === 'transcript' ? '“' : ''}
        <Marked parts={markedParts(match.snippet)} />
        {match.in === 'transcript' ? '”' : ''}
      </span>
    </Link>
  );
}

function Pill({ onClick, pressed, title, children }: { onClick?: () => void; pressed: boolean; title: string; children: React.ReactNode }) {
  if (!onClick) return <>{children}</>;
  return (
    <button type="button" onClick={onClick} aria-pressed={pressed} title={title} className="rounded-full transition-transform hover:-translate-y-px">
      {children}
    </button>
  );
}

export function ListSkeleton() {
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

function NoResults({ filters, onClear }: { filters: MeetingFilters; onClear: () => void }) {
  const parts = [filters.speaker && `with ${filters.speaker}`, filters.topic && `about ${filters.topic}`, filters.q && `matching “${filters.q}”`].filter(Boolean);
  return (
    <div className="sticker px-6 py-10 text-center" role="status">
      <Avatar style={LISTENER} pose={stillPose({ emotion: 'sad' })} className="mx-auto h-24 w-24" />
      <p className="mt-3 text-lg font-extrabold">No meetings {parts.join(' ')}.</p>
      <p className="mt-1 font-semibold text-ink-soft">Search looks at titles, summaries and everything anyone said. Try another word, or clear the filters.</p>
      <button type="button" className="btn btn-secondary btn-sm mt-4" onClick={onClear}>
        Clear filters
      </button>
    </div>
  );
}
