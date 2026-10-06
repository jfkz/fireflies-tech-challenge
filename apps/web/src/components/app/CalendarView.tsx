'use client';

import type { DayStats } from '@boringtalks/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ErrorNote } from '@/components/ui/ErrorNote';
import { useMe, useMeetings, useMeetingStats } from '@/hooks/queries';
import { heatmap, intensity, monthGrid, summarize } from '@/lib/calendar';
import { addDays, addMonths, compactMinutes, formatDay, formatMinutes, startOfMonth, startOfWeek, todayKey } from '@/lib/dates';
import { MeetingRow } from './MeetingsList';

/** Shades from "no meetings" to "a day lost to meetings", in the call palette. */
const LEVEL_BG = ['bg-white', 'bg-[#d9dcff]', 'bg-[#a9b0ff]', 'bg-[#6f7af7]', 'bg-[#3845db]'] as const;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function viewerTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** The start of a local calendar day as an ISO instant, for filtering meetings by day. */
function localDayStart(key: string): string {
  return new Date(`${key}T00:00:00`).toISOString();
}

/** Meeting intensity over the last year, the time it took, and a month you can page through. */
export function CalendarView() {
  const me = useMe();
  const tz = useMemo(() => viewerTimeZone(), []);
  const today = todayKey(new Date(), tz);
  const yearFrom = addDays(startOfWeek(today), -7 * 52);
  const year = useMeetingStats({ from: yearFrom, to: addDays(today, 1), tz });
  const [month, setMonth] = useState(startOfMonth(today));
  const monthStats = useMeetingStats({ from: month, to: addMonths(month, 1), tz });
  const [selected, setSelected] = useState<string | null>(null);

  const days = useMemo(() => year.data?.days ?? [], [year.data]);
  const totals = useMemo(() => summarize(days, today), [days, today]);

  const pick = (date: string) => {
    setSelected(date);
    setMonth(startOfMonth(date));
  };

  return (
    <div>
      <h1 className="font-display text-4xl leading-none sm:text-5xl">Calendar</h1>
      <p className="mt-2 font-semibold text-ink-soft">How many meetings you had, and how much of your time they took.</p>

      {me.isError ? (
        <div className="mt-6">
          <ErrorNote onRetry={() => me.refetch()}>{me.error.message}</ErrorNote>
        </div>
      ) : year.isError ? (
        <div className="mt-6">
          <ErrorNote onRetry={() => year.refetch()}>{year.error.message}</ErrorNote>
        </div>
      ) : (
        <>
          <dl className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-busy={year.isPending}>
            <Stat label="This week" value={formatMinutes(totals.week.totalSec)} detail={plural(totals.week.count, 'meeting')} />
            <Stat label="This month" value={formatMinutes(totals.month.totalSec)} detail={plural(totals.month.count, 'meeting')} />
            <Stat label="An average week" value={formatMinutes(totals.perWeek.totalSec)} detail={`${totals.perWeek.count.toFixed(1)} meetings`} />
            <Stat
              label="Busiest day"
              value={totals.busiest ? formatMinutes(totals.busiest.totalSec) : '—'}
              detail={totals.busiest ? formatDay(totals.busiest.date, today) : 'No meetings yet'}
            />
          </dl>

          <section className="sticker mt-6 p-5 sm:p-6" aria-label="Last 12 months">
            <div className="mb-4 flex flex-wrap items-baseline gap-3">
              <h2 className="font-display mr-auto text-2xl leading-none">Last 12 months</h2>
              <p className="text-sm font-bold text-ink-soft">
                {plural(totals.all.count, 'meeting')}, {formatMinutes(totals.all.totalSec)}
              </p>
            </div>
            <Heatmap days={days} today={today} selected={selected} onPick={pick} />
          </section>

          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start">
            <MonthView month={month} today={today} days={monthStats.data?.days ?? []} selected={selected} onPick={pick} onMonth={setMonth} />
            <DayMeetings date={selected} today={today} />
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="sticker px-4 py-3">
      <dt className="text-xs font-extrabold tracking-wide text-ink-soft uppercase">{label}</dt>
      <dd className="font-display mt-1 text-2xl leading-none text-ink">{value}</dd>
      <dd className="mt-1 text-sm font-bold text-ink-soft">{detail}</dd>
    </div>
  );
}

function cellTitle(date: string, count: number, totalSec: number, today: string): string {
  return count ? `${formatDay(date, today)}: ${plural(count, 'meeting')}, ${formatMinutes(totalSec)}` : `${formatDay(date, today)}: no meetings`;
}

/** GitHub-style: a column per week, Monday on top; darker = more time in meetings. */
function Heatmap({ days, today, selected, onPick }: { days: readonly DayStats[]; today: string; selected: string | null; onPick: (d: string) => void }) {
  const weeks = useMemo(() => heatmap(days, today), [days, today]);
  const scroller = useRef<HTMLDivElement>(null);
  // On narrow screens the year doesn't fit: start at the most recent weeks.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, []);
  return (
    <div>
      <div ref={scroller} className="overflow-x-auto pb-1" data-testid="heatmap">
        <div className="inline-flex gap-[3px]" role="grid" aria-label="Meetings per day over the last year">
          <div className="mr-1 grid grid-rows-7 gap-[3px] pt-5 text-[10px] font-bold text-ink-soft" aria-hidden>
            {WEEKDAYS.map((d, i) => (
              <span key={d} className="h-3 leading-3">
                {i % 2 === 0 ? d : ''}
              </span>
            ))}
          </div>
          {weeks.map((week) => {
            const firstOfMonth = week.find((c) => c.date.endsWith('-01'));
            return (
              <div key={week[0].date} className="relative grid w-3 grid-rows-[1.25rem_repeat(7,0.75rem)] gap-[3px]" role="row">
                {/* Absolute, so a label never widens its week's column. */}
                <span className="absolute top-0 left-0 text-[10px] leading-5 font-bold whitespace-nowrap text-ink-soft" aria-hidden>
                  {firstOfMonth ? formatDay(firstOfMonth.date, today, { month: 'short' }) : ''}
                </span>
                <span aria-hidden />
                {week.map((c) =>
                  c.future ? (
                    <span key={c.date} className="h-3 w-3" aria-hidden />
                  ) : (
                    <button
                      key={c.date}
                      type="button"
                      role="gridcell"
                      onClick={() => onPick(c.date)}
                      title={cellTitle(c.date, c.count, c.totalSec, today)}
                      aria-label={cellTitle(c.date, c.count, c.totalSec, today)}
                      aria-selected={selected === c.date}
                      data-level={c.level}
                      className={`h-3 w-3 rounded-[3px] border border-ink/25 ${LEVEL_BG[c.level]} ${selected === c.date ? 'outline-2 outline-offset-1 outline-ink' : ''} ${c.date === today ? 'border-ink' : ''}`}
                    />
                  ),
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end gap-1.5 text-xs font-bold text-ink-soft" aria-hidden>
        Less
        {LEVEL_BG.map((bg, i) => (
          <span key={bg} className={`h-3 w-3 rounded-[3px] border border-ink/25 ${bg}`} title={['No meetings', 'Under 30 min', 'Under 1½ h', 'Under 3 h', '3 h or more'][i]} />
        ))}
        More
      </div>
    </div>
  );
}

function MonthView({
  month,
  today,
  days,
  selected,
  onPick,
  onMonth,
}: {
  month: string;
  today: string;
  days: readonly DayStats[];
  selected: string | null;
  onPick: (d: string) => void;
  onMonth: (m: string) => void;
}) {
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);
  const max = Math.max(3600, ...days.map((d) => d.totalSec));
  const title = new Date(`${month}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return (
    <section className="sticker p-5 sm:p-6" aria-label={title}>
      <div className="mb-4 flex items-center gap-2">
        <h2 className="font-display mr-auto text-2xl leading-none">{title}</h2>
        <button type="button" className="btn btn-secondary btn-sm px-3" onClick={() => onMonth(addMonths(month, -1))} aria-label="Previous month">
          ‹
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onMonth(startOfMonth(today))} disabled={month === startOfMonth(today)}>
          Today
        </button>
        <button type="button" className="btn btn-secondary btn-sm px-3" onClick={() => onMonth(addMonths(month, 1))} aria-label="Next month">
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1.5 text-center text-xs font-extrabold text-ink-soft" aria-hidden>
        {WEEKDAYS.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="mt-1.5 grid grid-cols-7 gap-1.5">
        {monthGrid(month)
          .flat()
          .map(({ date, inMonth }) => {
            const s = byDate.get(date);
            const level = intensity(s?.totalSec ?? 0, s?.count ?? 0);
            return (
              <button
                key={date}
                type="button"
                onClick={() => onPick(date)}
                aria-pressed={selected === date}
                aria-label={cellTitle(date, s?.count ?? 0, s?.totalSec ?? 0, today)}
                className={`relative flex aspect-square min-h-12 flex-col justify-between overflow-hidden rounded-xl border-2 p-1.5 text-left transition-colors sm:min-h-16 ${
                  selected === date ? 'border-ink bg-sun-soft' : date === today ? 'border-ink bg-white' : 'border-ink/15 bg-white hover:border-ink/50'
                } ${inMonth ? '' : 'opacity-40'}`}
              >
                <span className={`text-sm font-extrabold ${date === today ? 'text-call-deep' : 'text-ink'}`}>{Number(date.slice(8))}</span>
                {s && (
                  <>
                    <span
                      className={`absolute inset-x-0 bottom-0 ${LEVEL_BG[level]} opacity-70`}
                      style={{ height: `${Math.max(12, (s.totalSec / max) * 70)}%` }}
                      aria-hidden
                    />
                    <span className="relative text-[10px] leading-tight font-extrabold text-ink sm:text-xs">
                      {s.count}×<span className="max-sm:hidden"> · {compactMinutes(s.totalSec)}</span>
                    </span>
                  </>
                )}
              </button>
            );
          })}
      </div>
    </section>
  );
}

/** The meetings of the picked day. */
function DayMeetings({ date, today }: { date: string | null; today: string }) {
  const list = useMeetings(date ? { from: localDayStart(date), to: localDayStart(addDays(date, 1)) } : {}, !!date);
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  if (!date) {
    return (
      <section className="sticker p-5 sm:p-6" aria-label="Day">
        <p className="font-semibold text-ink-soft">Pick a day to see its meetings.</p>
      </section>
    );
  }
  const label = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
  return (
    <section className="sticker overflow-hidden" aria-label={`Meetings on ${label}`}>
      <h2 className="font-display border-b-2 border-ink/10 px-5 py-4 text-2xl leading-none">{date === today ? `Today, ${label}` : label}</h2>
      {list.isPending ? (
        <p className="px-5 py-4 font-semibold text-ink-soft">Loading…</p>
      ) : list.isError ? (
        <div className="p-4">
          <ErrorNote onRetry={() => list.refetch()}>{list.error.message}</ErrorNote>
        </div>
      ) : items.length === 0 ? (
        <p className="px-5 py-4 font-semibold text-ink-soft">No meetings. A rare and beautiful day.</p>
      ) : (
        <ul className="divide-y-2 divide-ink/10" aria-label="Meetings">
          {items.map((m) => (
            <MeetingRow key={m.id} meeting={m} />
          ))}
        </ul>
      )}
    </section>
  );
}
