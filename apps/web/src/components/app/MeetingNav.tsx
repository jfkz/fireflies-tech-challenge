'use client';

import type { MeetingDetail, MeetingRef } from '@boringtalks/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useMemo, useState } from 'react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useSameDayMeetings, useUpdateMeeting } from '@/hooks/queries';
import { dateKey, formatDay, todayKey } from '@/lib/dates';
import { formatMeetingDate } from '@/lib/format';
import { chainNeighbours, dayNeighbours, isTyping, type Neighbours } from '@/lib/meeting-nav';

const href = (m: MeetingRef) => `/meetings/${m.id}`;

/**
 * Back to the list, the meetings before and after this one on the same day, and, when the meeting
 * continues earlier ones, its place in that chain. `[` `]` step through the day, `{` `}` through the chain.
 */
export function MeetingNav({ meeting: m }: { meeting: MeetingDetail }) {
  const router = useRouter();
  const sameDay = useSameDayMeetings(m.startedAt);
  const day = useMemo(() => dayNeighbours(m, sameDay.data ?? []), [m, sameDay.data]);
  const chain = useMemo(() => (m.chain ? chainNeighbours(m.chain, m.id) : null), [m]);

  useEffect(() => {
    const targets: Record<string, MeetingRef | null | undefined> = { '[': day.prev, ']': day.next, '{': chain?.prev, '}': chain?.next };
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('dialog[open]')) return;
      const to = targets[e.key];
      if (!to) return;
      e.preventDefault();
      router.push(href(to));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [day, chain, router]);

  const isToday = dateKey(new Date(m.startedAt)) === todayKey();
  const when = isToday ? 'today' : 'that day';

  return (
    <nav aria-label="Meeting navigation">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link href="/meetings" className="mr-auto inline-flex items-center gap-1.5 rounded-full text-sm font-extrabold text-ink-soft hover:text-ink">
          <span aria-hidden>←</span> All meetings
        </Link>
        {/* Only worth showing when there is somewhere to go. */}
        {day.total > 1 && (
          <div role="group" aria-label={`Meetings ${when}`} className="flex items-center gap-1.5">
            <Step to={day.prev} dir="prev" label={`Previous ${when}`} shortcut="[" />
            <span className="px-1 text-xs font-extrabold text-ink-soft tabular-nums" title={formatDay(dateKey(new Date(m.startedAt)), todayKey())}>
              {day.index + 1} of {day.total} {when}
            </span>
            <Step to={day.next} dir="next" label={`Next ${when}`} shortcut="]" />
          </div>
        )}
      </div>
      {m.chain && chain && <ChainBar meeting={m} chain={chain} />}
    </nav>
  );
}

/** A previous / next link, or a greyed-out stand-in at either end. */
function Step({ to, dir, label, shortcut }: { to: MeetingRef | null; dir: 'prev' | 'next'; label: string; shortcut: string }) {
  const text = dir === 'prev' ? (
    <>
      <span aria-hidden>←</span> {label}
    </>
  ) : (
    <>
      {label} <span aria-hidden>→</span>
    </>
  );
  const cls = 'inline-flex items-center gap-1 rounded-full border-2 px-2.5 py-0.5 text-xs font-extrabold';
  if (!to) {
    return (
      <span aria-disabled="true" className={`${cls} border-ink/15 text-ink-soft/60`}>
        {text}
      </span>
    );
  }
  return (
    <Link
      href={href(to)}
      aria-label={`${label}: ${to.title}`}
      title={`${to.title} (${shortcut})`}
      aria-keyshortcuts={shortcut}
      className={`${cls} border-ink bg-white text-ink transition-transform hover:-translate-y-px hover:bg-sun-soft`}
    >
      {text}
    </Link>
  );
}

/** "Chain · 2 of 4": why it's linked, the neighbours, the whole chain on request, and a way out. */
function ChainBar({ meeting: m, chain }: { meeting: MeetingDetail; chain: Neighbours }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const update = useUpdateMeeting(m.id);
  const listId = useId();
  const meetings = m.chain?.meetings ?? [];

  return (
    <div className="mt-3 rounded-2xl border-2 border-ink bg-call-light/50 px-4 py-2.5" data-testid="meeting-chain">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-sm font-extrabold text-ink">
          Chain <span aria-hidden>·</span>{' '}
          <span className="tabular-nums">
            {chain.index + 1} of {chain.total}
          </span>
        </span>
        <div className="flex items-center gap-1.5">
          <Step to={chain.prev} dir="prev" label="Previous in chain" shortcut="{" />
          <Step to={chain.next} dir="next" label="Next in chain" shortcut="}" />
        </div>
        <div className="ml-auto flex items-center gap-3">
          <button
            type="button"
            className="text-xs font-extrabold text-call-deep underline underline-offset-2"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? 'Hide the chain' : `Show all ${chain.total}`}
          </button>
          <button type="button" className="text-xs font-extrabold text-danger underline underline-offset-2" onClick={() => setConfirming(true)}>
            Remove from chain
          </button>
        </div>
      </div>
      {m.chain?.reason && <p className="mt-1 text-sm font-semibold text-ink-soft">{m.chain.reason}</p>}
      {open && (
        <ol id={listId} className="mt-2 space-y-1" aria-label="Meetings in this chain">
          {meetings.map((c, i) => {
            const current = c.id === m.id;
            return (
              <li key={c.id} className="flex items-baseline gap-2 text-sm">
                <span className="w-5 shrink-0 text-right text-xs font-extrabold text-ink-soft tabular-nums">{i + 1}.</span>
                {current ? (
                  <span aria-current="page" className="rounded-full bg-sun px-2 font-extrabold text-ink">
                    {c.title}
                  </span>
                ) : (
                  <Link href={href(c)} className="font-extrabold text-call-deep underline decoration-call-deep/40 underline-offset-2 hover:decoration-call-deep">
                    {c.title}
                  </Link>
                )}
                <time dateTime={c.startedAt} className="text-xs font-bold text-ink-soft">
                  {formatMeetingDate(c.startedAt)}
                </time>
              </li>
            );
          })}
        </ol>
      )}
      <ConfirmDialog
        open={confirming}
        title="Take this meeting out of the chain?"
        confirmLabel="Remove from chain"
        busy={update.isPending}
        error={update.isError ? update.error.message : null}
        onCancel={() => setConfirming(false)}
        onConfirm={() => update.mutate({ chain: null }, { onSuccess: () => setConfirming(false) })}
      >
        {chain.total > 2 ? `The other ${chain.total - 1} meetings stay linked.` : 'The other meeting won’t be in a chain any more.'} This one won’t be linked again by
        itself.
      </ConfirmDialog>
    </div>
  );
}
