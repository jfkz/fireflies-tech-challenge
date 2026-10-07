'use client';

import type { PeopleList, PersonSummary } from '@boringtalks/shared';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Avatar } from '@/components/avatar/Avatar';
import { SpeechBubble } from '@/components/avatar/SpeechBubble';
import { ErrorNote } from '@/components/ui/ErrorNote';
import { useMe, usePeople } from '@/hooks/queries';
import { stillPose } from '@/lib/avatar/pose';
import { LISTENER, styleForSpeaker } from '@/lib/avatar/styles';
import { formatMinutes } from '@/lib/dates';
import { lastMetLabel, PERIODS, peopleHref, periodFromParam, personHref, talkShare, type PeriodDays } from '@/lib/people';

const pose = stillPose();

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Who the user spends their meeting time with, most time together first, over 30 / 90 days or all time. */
export function PeopleView() {
  const params = useSearchParams();
  const router = useRouter();
  const days = periodFromParam(params.get('days'));
  const me = useMe();
  const people = usePeople(days, me.isSuccess);

  return (
    <div className="max-w-4xl">
      <div className="flex flex-wrap items-end gap-4">
        <div className="mr-auto">
          <h1 className="font-display text-4xl leading-none sm:text-5xl">People</h1>
          <p className="mt-2 font-semibold text-ink-soft">Who you spend your meeting time with, and who does the talking.</p>
        </div>
        <div role="group" aria-label="Period" className="flex rounded-full border-2 border-ink bg-white p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p.param}
              type="button"
              aria-pressed={days === p.days}
              onClick={() => router.push(peopleHref(p.days), { scroll: false })}
              className={`rounded-full px-3 py-1 text-xs font-extrabold ${days === p.days ? 'bg-ink text-white' : 'text-ink hover:bg-ink/5'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6">
        {me.isError ? (
          <ErrorNote onRetry={() => me.refetch()}>{me.error.message}</ErrorNote>
        ) : people.isError ? (
          <ErrorNote onRetry={() => people.refetch()}>{people.error.message}</ErrorNote>
        ) : people.isPending ? (
          <PeopleSkeleton />
        ) : people.data.people.length === 0 ? (
          <NobodyYet days={days} />
        ) : (
          <>
            <Overview list={people.data} days={days} />
            <ol className="sticker mt-4 divide-y-2 divide-ink/10 overflow-hidden" aria-label="People, most time together first">
              {people.data.people.map((p, i) => (
                <PersonRow key={p.name} person={p} rank={i + 1} max={people.data.people[0].togetherSec} />
              ))}
            </ol>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The period at a glance. Time "with people" isn't added up: two people in one meeting would count it
 * twice, so the line names the top person instead.
 */
function Overview({ list, days }: { list: PeopleList; days: PeriodDays }) {
  const top = list.people[0];
  const period = days ? `in the last ${days} days` : 'so far';
  return (
    <p className="font-semibold text-ink-soft" data-testid="people-overview">
      You spent <strong className="font-extrabold text-ink">{formatMinutes(list.meetingSec)}</strong> in meetings {period}, with{' '}
      <strong className="font-extrabold text-ink">
        {list.people.length} {list.people.length === 1 ? 'person' : 'people'}
      </strong> who have names. Most of it with{' '}
      <strong className="font-extrabold text-ink">{top.name}</strong>: {formatMinutes(top.togetherSec)}.
    </p>
  );
}

function PersonRow({ person: p, rank, max }: { person: PersonSummary; rank: number; max: number }) {
  const style = styleForSpeaker(p.name);
  const share = max > 0 ? Math.max(2, Math.round((p.togetherSec / max) * 100)) : 0;
  return (
    <li className="group relative flex items-center gap-3 px-4 py-3.5 transition-colors focus-within:bg-sun-soft hover:bg-sun-soft/60 sm:gap-4 sm:px-6">
      <span className="w-5 shrink-0 text-right text-sm font-extrabold text-ink-soft tabular-nums" aria-hidden>
        {rank}
      </span>
      <span className="shrink-0 overflow-hidden rounded-full border-2 border-ink" style={{ background: style.shirt }}>
        <Avatar style={style} pose={pose} className="h-11 w-11" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h2 className="mr-auto truncate text-lg leading-snug font-extrabold text-ink">
            {/* The whole row is the link (stretched). */}
            <Link href={personHref(p.name)} className="outline-none after:absolute after:inset-0 group-hover:underline group-hover:decoration-2 group-hover:underline-offset-4">
              {p.name}
            </Link>
          </h2>
          <span className="text-xs font-bold text-ink-soft">
            Last met <time dateTime={p.lastMetAt}>{lastMetLabel(p.lastMetAt)}</time>
          </span>
        </div>
        <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-paper" aria-hidden>
          <div className="h-full rounded-full border-r-2 border-ink" style={{ width: `${share}%`, background: style.shirt }} data-testid="together-bar" />
        </div>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-bold text-ink-soft">
          <span>
            <span className="font-extrabold text-ink">{formatMinutes(p.togetherSec)}</span> together
          </span>
          <span aria-hidden>·</span>
          <span>{plural(p.meetingCount, 'meeting')}</span>
          <span aria-hidden>·</span>
          <span>talks {talkShare(p.talkSec, p.togetherSec)}%</span>
          {p.openTasks > 0 && (
            <span className="rounded-full bg-sun-soft px-2 py-0.5 text-xs font-extrabold text-ink">{plural(p.openTasks, 'open task')}</span>
          )}
        </p>
      </div>
    </li>
  );
}

function NobodyYet({ days }: { days: PeriodDays }) {
  return (
    <div className="sticker flex flex-col items-center px-6 py-12 text-center" role="status">
      <div className="relative">
        <div className="absolute bottom-[86%] left-[55%] w-max">
          <SpeechBubble>Who were all those people?</SpeechBubble>
        </div>
        <Avatar style={LISTENER} pose={stillPose({ emotion: 'surprised' })} className="h-32 w-32" />
      </div>
      <h2 className="font-display mt-4 text-3xl">{days ? `Nobody in the last ${days} days` : 'Nobody here yet'}</h2>
      <p className="mt-2 max-w-[50ch] font-semibold text-ink-soft">
        People show up once the speakers in your meetings have names. The summary picks them up when people say who they are, and you can rename “Speaker 2” on
        any meeting page.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        {days !== null && (
          <Link href={peopleHref(null)} className="btn btn-secondary">
            Show all time
          </Link>
        )}
        <Link href="/meetings" className="btn btn-primary">
          Go to meetings
        </Link>
      </div>
    </div>
  );
}

export function PeopleSkeleton() {
  return (
    <div className="sticker divide-y-2 divide-ink/10" aria-busy="true" aria-label="Loading people">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-4 px-6 py-4">
          <div className="h-11 w-11 animate-pulse rounded-full bg-call-light/60" />
          <div className="flex-1">
            <div className="h-4 w-40 animate-pulse rounded-full bg-call-light/60" />
            <div className="mt-2 h-2.5 animate-pulse rounded-full bg-paper" style={{ width: `${90 - i * 20}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
