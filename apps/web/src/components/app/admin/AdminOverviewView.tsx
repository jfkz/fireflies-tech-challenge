'use client';

import type { AdminDay, AdminOverview } from '@boringtalks/shared';
import Link from 'next/link';
import { useState } from 'react';
import { ErrorNote } from '@/components/ui/ErrorNote';
import { useAdminOverview, useMe } from '@/hooks/queries';
import {
  appLabel,
  compact,
  DAILY_METRICS,
  niceMax,
  percent,
  SOURCE_LABELS,
  STATUS_LABELS,
  usd,
  valueOf,
  type DailyMetric,
} from '@/lib/admin';
import { formatDay } from '@/lib/dates';

const RANGES = [7, 30, 90] as const;

/** Usage across every account: people, meetings, apps, what it costs. */
export function AdminOverviewView() {
  const me = useMe();
  const [days, setDays] = useState<number>(30);
  const overview = useAdminOverview(days, me.data?.isAdmin === true);
  const o = overview.data;

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <h1 className="font-display mr-auto text-4xl leading-none sm:text-5xl">Overview</h1>
        <div role="group" aria-label="Period" className="flex gap-1.5">
          {RANGES.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={days === d}
              onClick={() => setDays(d)}
              className={`rounded-full border-2 border-ink px-3 py-0.5 text-xs font-extrabold ${days === d ? 'bg-sun' : 'bg-white'}`}
            >
              {d} days
            </button>
          ))}
        </div>
      </div>

      {overview.isError && !o ? (
        <div className="mt-6">
          <ErrorNote onRetry={() => overview.refetch()}>{overview.error.message}</ErrorNote>
        </div>
      ) : !o ? (
        <div className="sticker mt-6 h-72 animate-pulse" aria-busy="true" aria-label="Loading the overview" />
      ) : (
        <div className="mt-6 space-y-6" aria-busy={overview.isFetching}>
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
            <Stat label="Users" value={compact(o.users.total)} detail={`+${o.users.newInWindow} in ${o.days} days`} />
            <Stat label="Active this week" value={compact(o.users.active7d)} detail={`${o.users.active1d} today · ${o.users.active30d} in 30 days`} />
            <Stat label={`Meetings, ${o.days} days`} value={compact(o.meetings.inWindow)} detail={`${o.meetings.hoursInWindow} h recorded`} />
            <Stat label="Failed" value={percent(o.meetings.failureRate)} detail="of finished meetings" />
            <Stat label="AI spend" value={usd(o.costs.summaryUsd + o.costs.transcriptionUsd)} detail={`estimated, ${o.days} days`} />
            <Stat label="Audio stored" value={`${o.costs.storageGb} GB`} detail={`${usd(o.costs.storageUsdPerMonth)} a month`} />
          </dl>

          <DailyChart days={o.daily} />

          <div className="grid gap-6 lg:grid-cols-2">
            <Breakdown
              title="Where meetings come from"
              rows={Object.entries(o.meetings.bySource)
                .filter(([key]) => key !== 'demo')
                .map(([key, value]) => ({ label: SOURCE_LABELS[key as keyof typeof SOURCE_LABELS], value }))}
            />
            <Breakdown
              title="Where they are now"
              rows={Object.entries(o.meetings.byStatus).map(([key, value]) => ({ label: STATUS_LABELS[key as keyof typeof STATUS_LABELS], value }))}
            />
            <Breakdown
              title="Desktop apps connected"
              detail={`${o.devices.active30d} seen in the last 30 days`}
              rows={o.devices.versions.map((v) => ({ label: appLabel(v.platform, v.version), value: v.count }))}
              empty="No computers connected yet."
            />
            <Costs o={o} />
          </div>

          <p className="text-sm font-bold text-ink-soft">
            {o.reports.last7d === 0 ? (
              'No problem reports in the last 7 days.'
            ) : (
              <>
                {o.reports.last7d} problem {o.reports.last7d === 1 ? 'report' : 'reports'} in the last 7 days
                {o.reports.hangs7d > 0 && ` (${o.reports.hangs7d} ${o.reports.hangs7d === 1 ? 'hang' : 'hangs'})`}.{' '}
                <Link href="/admin/reports" className="font-extrabold text-call-deep underline underline-offset-2">
                  Read them
                </Link>
              </>
            )}{' '}
            · {o.users.admins} {o.users.admins === 1 ? 'admin' : 'admins'} · demo meetings are not counted
          </p>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="sticker px-4 py-3">
      <dt className="text-xs font-extrabold tracking-wide text-ink-soft uppercase">{label}</dt>
      <dd className="mt-1 text-3xl leading-none font-extrabold text-ink tabular-nums">{value}</dd>
      <dd className="mt-1 text-sm font-bold text-ink-soft">{detail}</dd>
    </div>
  );
}

/** One measure per day as columns, with a value on hover or focus and the same numbers as a table. */
export function DailyChart({ days }: { days: AdminDay[] }) {
  const [metric, setMetric] = useState<DailyMetric>('meetings');
  const [hover, setHover] = useState<number | null>(null);
  const spec = DAILY_METRICS.find((m) => m.key === metric)!;
  const values = days.map((d) => valueOf(d, metric));
  const top = niceMax(Math.max(0, ...values));
  const total = values.reduce((a, b) => a + b, 0);
  const shown = hover !== null ? days[hover] : null;
  const label = (d: AdminDay) => `${formatDay(d.date)}: ${valueOf(d, metric)} ${spec.unit(valueOf(d, metric))}`;
  const ticks = [0, Math.floor(days.length / 2), days.length - 1].filter((i, n, all) => i >= 0 && all.indexOf(i) === n);

  return (
    <section className="sticker p-5 sm:p-6" aria-label="Per day">
      <div className="mb-4 flex flex-wrap items-baseline gap-3">
        <h2 className="font-display mr-auto text-2xl leading-none">
          {spec.label} per day <span className="font-sans text-base font-bold text-ink-soft">· {Math.round(total * 10) / 10} in all</span>
        </h2>
        <div role="group" aria-label="Measure" className="flex gap-1.5">
          {DAILY_METRICS.map((m) => (
            <button
              key={m.key}
              type="button"
              aria-pressed={metric === m.key}
              onClick={() => setMetric(m.key)}
              className={`rounded-full border-2 border-ink px-3 py-0.5 text-xs font-extrabold ${metric === m.key ? 'bg-sun' : 'bg-white'}`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <div className="flex w-8 shrink-0 flex-col justify-between pb-0 text-right text-[11px] font-bold text-ink-soft tabular-nums" aria-hidden>
          <span className="-translate-y-1/2">{compact(top)}</span>
          <span className="translate-y-1/2">0</span>
        </div>
        <div className="relative min-w-0 flex-1">
          {/* Hairline grid: top and middle; the baseline is the bottom border. */}
          <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-ink/10" aria-hidden />
          <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-ink/10" aria-hidden />
          <div className="flex h-44 items-end gap-[2px] border-b border-ink/25" onPointerLeave={() => setHover(null)} role="list" aria-label={`${spec.label} per day`}>
            {days.map((d, i) => {
              const v = valueOf(d, metric);
              return (
                <button
                  key={d.date}
                  type="button"
                  role="listitem"
                  aria-label={label(d)}
                  onPointerEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  className="flex h-full min-w-0 flex-1 items-end justify-center focus-visible:outline-2 focus-visible:outline-call-deep"
                >
                  <span
                    className={`block w-full max-w-6 rounded-t-[4px] ${hover === i ? 'bg-call-deep' : 'bg-call'}`}
                    style={{ height: `${(v / top) * 100}%`, minHeight: v > 0 ? 2 : 0 }}
                  />
                </button>
              );
            })}
          </div>
          {shown && hover !== null && (
            <div
              role="tooltip"
              className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 -translate-y-full rounded-xl border-2 border-ink bg-white px-2.5 py-1 text-xs whitespace-nowrap shadow-[2px_3px_0_0_var(--color-ink)]"
              style={{ left: `${((hover + 0.5) / days.length) * 100}%` }}
            >
              <strong className="text-sm text-ink tabular-nums">{valueOf(shown, metric)}</strong>{' '}
              <span className="font-bold text-ink-soft">
                {spec.unit(valueOf(shown, metric))} · {formatDay(shown.date)}
              </span>
            </div>
          )}
          <div className="relative mt-1 h-4 text-[11px] font-bold text-ink-soft" aria-hidden>
            {ticks.map((i) => (
              <span
                key={i}
                className="absolute -translate-x-1/2 whitespace-nowrap"
                style={{ left: `${((i + 0.5) / days.length) * 100}%`, transform: i === 0 ? 'none' : i === days.length - 1 ? 'translateX(-100%)' : undefined }}
              >
                {formatDay(days[i].date, undefined, { month: 'short', day: 'numeric' })}
              </span>
            ))}
          </div>
        </div>
      </div>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-extrabold text-call-deep">Show as a table</summary>
        <div className="mt-2 max-h-64 overflow-auto">
          <table className="w-full text-left tabular-nums">
            <thead className="text-xs text-ink-soft uppercase">
              <tr>
                <th className="py-1 pr-4">Day</th>
                <th className="py-1 pr-4">Meetings</th>
                <th className="py-1 pr-4">Hours</th>
                <th className="py-1">Sign-ups</th>
              </tr>
            </thead>
            <tbody className="font-semibold">
              {days.map((d) => (
                <tr key={d.date} className="border-t border-ink/10">
                  <td className="py-1 pr-4">{formatDay(d.date)}</td>
                  <td className="py-1 pr-4">{d.meetings}</td>
                  <td className="py-1 pr-4">{d.hours}</td>
                  <td className="py-1">{d.signups}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

/** Magnitudes in one hue: a bar per row, the value at its tip. */
function Breakdown({ title, detail, rows, empty = 'Nothing yet.' }: { title: string; detail?: string; rows: { label: string; value: number }[]; empty?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  return (
    <section className="sticker p-5" aria-label={title}>
      <h2 className="text-sm font-extrabold tracking-wide text-ink-soft uppercase">{title}</h2>
      {detail && <p className="mt-0.5 text-sm font-bold text-ink-soft">{detail}</p>}
      {sorted.length === 0 ? (
        <p className="mt-3 text-sm font-semibold text-ink-soft">{empty}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {sorted.map((r) => (
            <li key={r.label} className="grid grid-cols-[minmax(0,10rem)_1fr] items-center gap-3 text-sm">
              <span className="truncate font-bold text-ink">{r.label}</span>
              <span className="flex items-center gap-2">
                <span className="h-3 rounded-r-[4px] bg-call" style={{ width: `${(r.value / max) * 100}%`, minWidth: r.value > 0 ? 2 : 0 }} />
                <span className="font-extrabold text-ink tabular-nums">{r.value}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Costs({ o }: { o: AdminOverview }) {
  const rows = [
    { label: 'Summaries', value: usd(o.costs.summaryUsd), detail: `${compact(o.costs.summaryInputTokens)} tokens in, ${compact(o.costs.summaryOutputTokens)} out` },
    { label: 'Server transcription', value: usd(o.costs.transcriptionUsd), detail: `${o.costs.serverTranscribedHours} channel-hours` },
    { label: 'Audio storage', value: `${usd(o.costs.storageUsdPerMonth)}/mo`, detail: `${o.costs.storageGb} GB kept` },
  ];
  return (
    <section className="sticker p-5" aria-label="What it costs">
      <h2 className="text-sm font-extrabold tracking-wide text-ink-soft uppercase">What it costs</h2>
      <p className="mt-0.5 text-sm font-bold text-ink-soft">Estimated from list prices (docs/COSTS.md), last {o.days} days</p>
      <dl className="mt-3 space-y-2 text-sm">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline gap-3">
            <dt className="font-bold text-ink">{r.label}</dt>
            <dd className="ml-auto text-right">
              <span className="font-extrabold text-ink tabular-nums">{r.value}</span>
              <span className="block text-xs font-bold text-ink-soft">{r.detail}</span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
