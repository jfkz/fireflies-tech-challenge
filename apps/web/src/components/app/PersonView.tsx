'use client';

import { formatDuration, type PersonDetail, type TaskItem } from '@boringtalks/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Avatar } from '@/components/avatar/Avatar';
import { ErrorNote } from '@/components/ui/ErrorNote';
import { TopicPill } from '@/components/ui/TopicPill';
import { usePerson, useRenamePerson, useToggleTask } from '@/hooks/queries';
import { ApiRequestError } from '@/lib/api';
import { stillPose } from '@/lib/avatar/pose';
import { LISTENER, styleForSpeaker } from '@/lib/avatar/styles';
import { dateKey, formatDay, formatMinutes, todayKey } from '@/lib/dates';
import { meetingsHref } from '@/lib/filters';
import { formatMeetingDate } from '@/lib/format';
import { lastMetLabel, personHref, talkShare } from '@/lib/people';
import { TaskRow } from './TasksView';

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** One person across every meeting: time together, what you talk about, what they owe, and where. */
export function PersonView({ name }: { name: string }) {
  const person = usePerson(name);

  if (person.isPending) return <PersonSkeleton />;
  if (person.isError) {
    const notFound = person.error instanceof ApiRequestError && person.error.status === 404;
    return notFound ? <PersonNotFound name={name} /> : <ErrorNote onRetry={() => person.refetch()}>{person.error.message}</ErrorNote>;
  }
  return <PersonDetailView person={person.data} />;
}

function PersonDetailView({ person: p }: { person: PersonDetail }) {
  const style = styleForSpeaker(p.name);
  const toggle = useToggleTask();
  const today = todayKey();
  // A task ticked off here stays (struck through) while you're on the page, so nothing jumps.
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const taskKey = (t: TaskItem) => `${t.meeting.id}/${t.id}`;
  const open = p.tasks.filter((t) => !t.done || ticked.has(taskKey(t)));
  const done = p.tasks.length - open.length;
  const first = p.meetings.at(-1);

  return (
    <article className="max-w-4xl">
      <Link href="/people" className="inline-flex items-center gap-1.5 rounded-full text-sm font-extrabold text-ink-soft hover:text-ink">
        <span aria-hidden>←</span> People
      </Link>
      <header className="mt-4 flex items-center gap-4">
        <span className="shrink-0 overflow-hidden rounded-full border-[2.5px] border-ink" style={{ background: style.shirt }}>
          <Avatar style={style} pose={stillPose({ emotion: 'happy' })} className="h-16 w-16 sm:h-20 sm:w-20" />
        </span>
        <div className="min-w-0">
          <h1 className="font-display text-4xl leading-none break-words sm:text-5xl">{p.name}</h1>
          <RenamePerson person={p} />
        </div>
      </header>

      <dl className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Time together" value={formatMinutes(p.togetherSec)} detail={`in ${plural(p.meetingCount, 'meeting')}`} />
        <Stat label="Meetings" value={String(p.meetingCount)} detail={first ? `since ${formatDay(dateKey(new Date(first.startedAt)), today, { month: 'short', day: 'numeric' })}` : '—'} />
        <Stat label="Their talk time" value={formatMinutes(p.talkSec)} detail={`${talkShare(p.talkSec, p.togetherSec)}% of the time`} />
        <Stat label="Last met" value={lastMetLabel(p.lastMetAt)} detail={formatMeetingDate(p.lastMetAt)} />
      </dl>

      {p.topics.length > 0 && (
        <section className="mt-8" aria-label="Topics">
          <h2 className="font-display text-2xl leading-none">What you talk about</h2>
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {p.topics.map((t) => (
              <li key={t.value}>
                <Link href={meetingsHref({ topic: t.value })} className="rounded-full" title={`${plural(t.count, 'meeting')} about ${t.value}`}>
                  <TopicPill topic={t.value} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="sticker mt-8 overflow-hidden" aria-label="Their tasks">
        <h2 className="flex items-center gap-2 border-b-2 border-ink/10 px-5 py-3 text-sm font-extrabold tracking-wide text-ink-soft uppercase">
          Open tasks
          <span className="rounded-full bg-paper px-2 text-xs text-ink">{open.filter((t) => !t.done).length}</span>
          {done > 0 && <span className="ml-auto text-xs normal-case">and {done} done</span>}
        </h2>
        {open.length === 0 ? (
          <p className="px-5 py-4 text-sm font-semibold text-ink-soft">Nothing open. They’re all caught up.</p>
        ) : (
          <ul className="divide-y-2 divide-ink/10">
            {open.map((t) => (
              <TaskRow
                key={taskKey(t)}
                task={t}
                today={today}
                onToggle={(next) => {
                  setTicked((s) => new Set(s).add(taskKey(t)));
                  toggle.mutate({ ...t, done: next });
                }}
              />
            ))}
          </ul>
        )}
        {toggle.isError && (
          <div className="px-5 pb-4">
            <ErrorNote>{toggle.error.message}</ErrorNote>
          </div>
        )}
      </section>

      <section className="sticker mt-8 overflow-hidden" aria-label="Meetings together">
        <h2 className="border-b-2 border-ink/10 px-5 py-3 text-sm font-extrabold tracking-wide text-ink-soft uppercase">Meetings together</h2>
        <ul className="divide-y-2 divide-ink/10">
          {p.meetings.map((m) => (
            <li key={m.id} className="group relative flex flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-3 hover:bg-sun-soft/60 focus-within:bg-sun-soft">
              <Link
                href={`/meetings/${m.id}`}
                className="mr-auto min-w-0 font-extrabold text-ink outline-none after:absolute after:inset-0 group-hover:underline group-hover:decoration-2 group-hover:underline-offset-4"
              >
                {m.title}
              </Link>
              <span className="text-sm font-bold text-ink-soft">
                <time dateTime={m.startedAt}>{formatMeetingDate(m.startedAt)}</time>
                <span aria-hidden> · </span>
                {formatDuration(m.durationSec)}
                <span aria-hidden> · </span>
                talked {formatMinutes(m.talkSec)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}

/** Renames them in every meeting. Typing someone else's name merges the two into that person. */
function RenamePerson({ person: p }: { person: PersonDetail }) {
  const router = useRouter();
  const rename = useRenamePerson();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(p.name);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  if (!editing) {
    return (
      <button
        type="button"
        className="mt-2 text-sm font-extrabold text-call-deep underline underline-offset-2"
        onClick={() => {
          setDraft(p.name);
          rename.reset();
          setEditing(true);
        }}
      >
        Rename or merge
      </button>
    );
  }
  return (
    <form
      className="mt-3 max-w-md space-y-2"
      aria-label="Rename or merge"
      onSubmit={(e) => {
        e.preventDefault();
        const newName = draft.trim();
        if (!newName || newName === p.name) return setEditing(false);
        rename.mutate(
          { name: p.name, newName },
          {
            onSuccess: (next) => {
              setEditing(false);
              router.replace(personHref(next.name));
            },
          },
        );
      }}
    >
      <label htmlFor="person-name" className="block text-sm font-semibold text-ink-soft">
        Their name in every meeting. Use someone else’s name to merge the two.
      </label>
      <div className="flex gap-2">
        <input id="person-name" ref={input} className="field py-1.5" value={draft} maxLength={80} onChange={(e) => setDraft(e.target.value)} />
        <button type="submit" className="btn btn-primary btn-sm shrink-0" disabled={rename.isPending}>
          {rename.isPending ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="btn btn-secondary btn-sm shrink-0" onClick={() => setEditing(false)} disabled={rename.isPending}>
          Cancel
        </button>
      </div>
      {rename.isError && <ErrorNote>{rename.error.message}</ErrorNote>}
    </form>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="sticker px-4 py-3">
      <dt className="text-xs font-extrabold tracking-wide text-ink-soft uppercase">{label}</dt>
      <dd className="font-display mt-1 text-2xl leading-none text-ink first-letter:uppercase">{value}</dd>
      <dd className="mt-1 text-sm font-bold text-ink-soft">{detail}</dd>
    </div>
  );
}

export function PersonSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading person" className="max-w-4xl">
      <div className="h-4 w-20 animate-pulse rounded-full bg-call-light/60" />
      <div className="mt-5 flex items-center gap-4">
        <div className="h-20 w-20 animate-pulse rounded-full bg-call-light/60" />
        <div className="h-10 w-56 animate-pulse rounded-full bg-call-light/60" />
      </div>
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="sticker h-20 animate-pulse" />
        ))}
      </div>
      <div className="sticker mt-8 h-64 animate-pulse" />
    </div>
  );
}

function PersonNotFound({ name }: { name: string }) {
  return (
    <div className="sticker flex flex-col items-center px-6 py-14 text-center">
      <Avatar style={LISTENER} pose={stillPose({ emotion: 'surprised' })} look={-1} className="h-32 w-32" />
      <h1 className="font-display mt-4 text-3xl">No one called {name}</h1>
      <p className="mt-2 max-w-[46ch] font-semibold text-ink-soft">
        Nobody by that name spoke in your meetings. They may have been renamed or merged into someone else.
      </p>
      <Link href="/people" className="btn btn-primary mt-6">
        See everyone
      </Link>
    </div>
  );
}
