'use client';

import type { TaskItem } from '@boringtalks/shared';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Avatar } from '@/components/avatar/Avatar';
import { SpeechBubble } from '@/components/avatar/SpeechBubble';
import { ErrorNote } from '@/components/ui/ErrorNote';
import { SpeakerChip } from '@/components/ui/SpeakerChip';
import { useMe, useTasks, useToggleTask } from '@/hooks/queries';
import { stillPose } from '@/lib/avatar/pose';
import { LISTENER } from '@/lib/avatar/styles';
import { formatDay, todayKey } from '@/lib/dates';
import { dueLabel, groupOf, groupTasks, ownersOf } from '@/lib/tasks';

/** Every action item from every meeting, soonest due first, each linked to where it was promised. */
export function TasksView() {
  const me = useMe();
  const open = useTasks('open', undefined, me.isSuccess);
  const [showDone, setShowDone] = useState(false);
  const done = useTasks('done', undefined, me.isSuccess && showDone);
  const toggle = useToggleTask();
  const [owner, setOwner] = useState<string | null>(null);
  const today = todayKey();

  const openItems = useMemo(() => open.data?.pages.flatMap((p) => p.items) ?? [], [open.data]);
  const doneItems = useMemo(() => done.data?.pages.flatMap((p) => p.items) ?? [], [done.data]);
  const owners = useMemo(() => ownersOf(openItems.filter((t) => !t.done)), [openItems]);
  const visible = (items: TaskItem[]) => (owner ? items.filter((t) => t.owner === owner) : items);
  // A task ticked off here stays in its section (struck through) until the next refresh, so nothing jumps.
  const groups = groupTasks(visible(openItems), today, { ignoreDone: true });

  return (
    <div className="max-w-4xl">
      <h1 className="font-display text-4xl leading-none sm:text-5xl">Tasks</h1>
      <p className="mt-2 font-semibold text-ink-soft">Everything anyone promised in your meetings, soonest due first.</p>

      {/* Stays while filtered, even if that person has nothing left, so the filter can be cleared. */}
      {(owners.length > 1 || owner !== null) && (
        <div className="mt-5 flex flex-wrap items-center gap-1.5" role="group" aria-label="Whose tasks">
          <button type="button" aria-pressed={owner === null} onClick={() => setOwner(null)} className={`rounded-full border-2 border-ink px-3 py-0.5 text-xs font-extrabold ${owner === null ? 'bg-sun' : 'bg-white'}`}>
            Everyone
          </button>
          {(owner && !owners.includes(owner) ? [owner, ...owners] : owners).map((o) => (
            <button key={o} type="button" aria-pressed={owner === o} onClick={() => setOwner(owner === o ? null : o)} className="rounded-full" title={`Tasks for ${o}`}>
              <SpeakerChip name={o} active={owner === o} />
            </button>
          ))}
        </div>
      )}

      <div className="mt-6 space-y-6">
        {me.isError ? (
          <ErrorNote onRetry={() => me.refetch()}>{me.error.message}</ErrorNote>
        ) : open.isError && !open.data ? (
          <ErrorNote onRetry={() => open.refetch()}>{open.error.message}</ErrorNote>
        ) : open.isPending ? (
          <TasksSkeleton />
        ) : groups.length === 0 ? (
          <NothingToDo filtered={owner !== null} />
        ) : (
          groups.map((g) => (
            <section key={g.key} aria-label={g.label} className="sticker overflow-hidden">
              <h2 className={`flex items-center gap-2 border-b-2 border-ink/10 px-5 py-3 text-sm font-extrabold tracking-wide uppercase ${g.key === 'overdue' ? 'text-danger' : 'text-ink-soft'}`}>
                {g.label}
                <span className="rounded-full bg-paper px-2 text-xs text-ink">{g.items.length}</span>
              </h2>
              <ul className="divide-y-2 divide-ink/10">
                {g.items.map((t) => (
                  <TaskRow key={`${t.meeting.id}/${t.id}`} task={t} today={today} onToggle={(next) => toggle.mutate({ ...t, done: next })} />
                ))}
              </ul>
            </section>
          ))
        )}
        {open.hasNextPage && (
          <div className="flex justify-center">
            <button type="button" className="btn btn-secondary" onClick={() => open.fetchNextPage()} disabled={open.isFetchingNextPage}>
              {open.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
        {toggle.isError && <ErrorNote>{toggle.error.message}</ErrorNote>}

        {open.isSuccess &&
          (showDone ? (
            <section aria-label="Done" className="sticker overflow-hidden opacity-90">
              <h2 className="flex items-center gap-2 border-b-2 border-ink/10 px-5 py-3 text-sm font-extrabold tracking-wide text-ink-soft uppercase">
                Done
                {done.isSuccess && <span className="rounded-full bg-paper px-2 text-xs text-ink">{visible(doneItems).length}</span>}
                <button type="button" className="ml-auto text-xs font-extrabold text-call-deep normal-case underline underline-offset-2" onClick={() => setShowDone(false)}>
                  Hide
                </button>
              </h2>
              {done.isPending ? (
                <p className="px-5 py-4 text-sm font-semibold text-ink-soft">Loading…</p>
              ) : visible(doneItems).length === 0 ? (
                <p className="px-5 py-4 text-sm font-semibold text-ink-soft">Nothing ticked off yet.</p>
              ) : (
                <ul className="divide-y-2 divide-ink/10">
                  {visible(doneItems).map((t) => (
                    <TaskRow key={`${t.meeting.id}/${t.id}`} task={t} today={today} onToggle={(next) => toggle.mutate({ ...t, done: next })} />
                  ))}
                </ul>
              )}
            </section>
          ) : (
            <button type="button" className="text-sm font-extrabold text-call-deep underline underline-offset-2" onClick={() => setShowDone(true)}>
              Show done tasks
            </button>
          ))}
      </div>
    </div>
  );
}

export function TaskRow({ task: t, today, onToggle }: { task: TaskItem; today: string; onToggle: (done: boolean) => void }) {
  const id = `task-${t.meeting.id}-${t.id}`;
  const due = dueLabel(t.dueDate, today);
  const late = !t.done && groupOf(t, today) === 'overdue';
  return (
    <li className="flex items-start gap-3 px-5 py-3.5">
      <input id={id} type="checkbox" className="check mt-1" checked={t.done} onChange={(e) => onToggle(e.target.checked)} />
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className={`cursor-pointer font-bold ${t.done ? 'text-ink-soft line-through decoration-2' : 'text-ink'}`}>
          {t.text}
        </label>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-extrabold">
          {t.owner && <SpeakerChip name={t.owner} />}
          {due && (
            <span className={`rounded-full px-2 py-0.5 ${late ? 'bg-danger text-white' : 'bg-sun-soft text-ink'}`} title={t.due ? `Said: “${t.due}”` : undefined}>
              {due}
            </span>
          )}
          {!due && t.due && <span className="rounded-full bg-sun-soft px-2 py-0.5 text-ink">“{t.due}”</span>}
          <span className="font-bold text-ink-soft">
            from{' '}
            <Link href={`/meetings/${t.meeting.id}#task-${t.id}`} className="font-extrabold text-call-deep underline decoration-call-deep/40 underline-offset-2 hover:decoration-call-deep">
              {t.meeting.title}
            </Link>
            <span aria-hidden> · </span>
            {formatDay(t.meeting.startedAt.slice(0, 10), today, { month: 'short', day: 'numeric' })}
          </span>
        </div>
      </div>
    </li>
  );
}

function NothingToDo({ filtered }: { filtered: boolean }) {
  return (
    <div className="sticker flex flex-col items-center px-6 py-12 text-center" role="status">
      <div className="relative">
        <div className="absolute bottom-[86%] left-[55%] w-max">
          <SpeechBubble>{filtered ? 'They’re all caught up.' : 'Nothing to do. Suspicious.'}</SpeechBubble>
        </div>
        <Avatar style={LISTENER} pose={stillPose({ emotion: 'happy' })} className="h-32 w-32" />
      </div>
      <h2 className="font-display mt-4 text-3xl">{filtered ? 'No open tasks for them' : 'No open tasks'}</h2>
      <p className="mt-2 max-w-[46ch] font-semibold text-ink-soft">
        When someone in a meeting says they’ll do something, it shows up here with who owns it and when it’s due.
      </p>
    </div>
  );
}

function TasksSkeleton() {
  return (
    <div className="sticker divide-y-2 divide-ink/10" aria-busy="true" aria-label="Loading tasks">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex gap-3 px-5 py-4">
          <div className="h-5 w-5 animate-pulse rounded-md bg-paper" />
          <div className="flex-1">
            <div className="h-4 w-2/3 animate-pulse rounded-full bg-call-light/60" />
            <div className="mt-2 h-3 w-1/3 animate-pulse rounded-full bg-paper" />
          </div>
        </div>
      ))}
    </div>
  );
}
