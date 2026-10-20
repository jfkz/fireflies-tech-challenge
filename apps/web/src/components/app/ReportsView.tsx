'use client';

import type { ProblemReportDetail, ProblemReportKind, ProblemReportSummary } from '@boringtalks/shared';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { ErrorNote } from '@/components/ui/ErrorNote';
import { useMe, useReport, useReports, type ReportFilters } from '@/hooks/queries';
import { formatBytes, formatMeetingDate } from '@/lib/format';

const KINDS: { value: ProblemReportKind | undefined; label: string }[] = [
  { value: undefined, label: 'All' },
  { value: 'hang', label: 'Hangs' },
  { value: 'user', label: 'Sent by users' },
];

/** Every user's problem reports ("Report a Problem…" and hangs the apps noticed), for admins. */
export function ReportsView() {
  const me = useMe();
  const admin = me.data?.isAdmin === true;
  const [filters, setFilters] = useState<ReportFilters>({});
  const [userText, setUserText] = useState('');
  const reports = useReports(filters, admin);
  const items = reports.data?.pages.flatMap((p) => p.items) ?? [];

  const search = (e: FormEvent) => {
    e.preventDefault();
    setFilters((f) => ({ ...f, user: userText.trim() || undefined }));
  };

  return (
    <div className="max-w-5xl">
      <h1 className="font-display text-4xl leading-none sm:text-5xl">Problem reports</h1>
      <p className="mt-2 font-semibold text-ink-soft">What the desktop apps sent from Report a Problem, and the hangs they noticed. Newest first.</p>

      {me.isError ? (
        <div className="mt-6">
          <ErrorNote onRetry={() => me.refetch()}>{me.error.message}</ErrorNote>
        </div>
      ) : me.isSuccess && !admin ? (
        <AdminsOnly />
      ) : (
        <>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Kind">
              {KINDS.map((k) => (
                <button
                  key={k.label}
                  type="button"
                  aria-pressed={filters.kind === k.value}
                  onClick={() => setFilters((f) => ({ ...f, kind: k.value }))}
                  className={`rounded-full border-2 border-ink px-3 py-0.5 text-xs font-extrabold ${filters.kind === k.value ? 'bg-sun' : 'bg-white'}`}
                >
                  {k.label}
                </button>
              ))}
            </div>
            <form onSubmit={search} className="flex w-full items-center gap-2 sm:w-auto" role="search">
              <input
                type="search"
                className="field min-w-0 flex-1 py-1.5 text-sm sm:w-64"
                placeholder="User email or id"
                aria-label="User email or id"
                value={userText}
                onChange={(e) => setUserText(e.target.value)}
              />
              <button type="submit" className="btn btn-secondary btn-sm">
                Filter
              </button>
            </form>
          </div>

          <div className="mt-6 space-y-6">
            {reports.isError && !reports.data ? (
              <ErrorNote onRetry={() => reports.refetch()}>{reports.error.message}</ErrorNote>
            ) : me.isPending || reports.isPending ? (
              <div className="sticker h-64 animate-pulse" aria-busy="true" aria-label="Loading reports" />
            ) : items.length === 0 ? (
              <p className="sticker px-6 py-10 text-center font-bold text-ink-soft" role="status">
                {filters.user || filters.kind ? 'No reports match.' : 'No reports yet. Nothing has gone wrong, or nobody said so.'}
              </p>
            ) : (
              <ul className="sticker divide-y-2 divide-ink/10 overflow-hidden" aria-label="Reports">
                {items.map((r) => (
                  <ReportRow key={r.id} report={r} />
                ))}
              </ul>
            )}
            {reports.hasNextPage && (
              <div className="flex justify-center">
                <button type="button" className="btn btn-secondary" onClick={() => reports.fetchNextPage()} disabled={reports.isFetchingNextPage}>
                  {reports.isFetchingNextPage ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ReportRow({ report: r }: { report: ProblemReportSummary }) {
  const firstLine = r.message.split('\n')[0].trim();
  return (
    <li>
      <Link href={`/admin/reports/${r.id}`} className="block px-5 py-3.5 hover:bg-paper">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-extrabold">
          <KindChip kind={r.kind} />
          <span className="text-ink">{r.user.email ?? r.user.id}</span>
          <span className="text-ink-soft">
            {appLabel(r)} · {r.system.os}
          </span>
          <time dateTime={r.createdAt} className="ml-auto text-ink-soft">
            {formatMeetingDate(r.createdAt)}
          </time>
        </div>
        <p className={`mt-1.5 truncate font-bold ${firstLine ? 'text-ink' : 'text-ink-soft italic'}`}>{firstLine || 'No message'}</p>
      </Link>
    </li>
  );
}

/** One report in full: who, which app, what they wrote, the diagnostics and the app's log. */
export function ReportView({ id }: { id: string }) {
  const me = useMe();
  const admin = me.data?.isAdmin === true;
  const report = useReport(id, admin);

  return (
    <div className="max-w-5xl">
      <Link href="/admin/reports" className="text-sm font-extrabold text-call-deep underline underline-offset-2">
        ← All reports
      </Link>
      {me.isError ? (
        <div className="mt-6">
          <ErrorNote onRetry={() => me.refetch()}>{me.error.message}</ErrorNote>
        </div>
      ) : me.isSuccess && !admin ? (
        <AdminsOnly />
      ) : report.isError ? (
        <div className="mt-6">
          <ErrorNote onRetry={() => report.refetch()}>{report.error.message}</ErrorNote>
        </div>
      ) : !report.data ? (
        <div className="sticker mt-6 h-64 animate-pulse" aria-busy="true" aria-label="Loading report" />
      ) : (
        <ReportDetail report={report.data} />
      )}
    </div>
  );
}

function ReportDetail({ report: r }: { report: ProblemReportDetail }) {
  const diagnostics = Object.entries(r.diagnostics);
  return (
    <>
      <h1 className="font-display mt-3 flex flex-wrap items-center gap-3 text-4xl leading-none">
        {r.kind === 'hang' ? 'Hang' : 'Problem report'} <KindChip kind={r.kind} />
      </h1>
      <dl className="sticker mt-5 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 px-5 py-4 text-sm">
        <Fact label="Sent">{new Date(r.createdAt).toLocaleString()}</Fact>
        <Fact label="From">
          {r.user.email ?? '(no email)'} <span className="text-ink-soft">· user {r.user.id}</span>
          {r.deviceId && <span className="text-ink-soft"> · device {r.deviceId}</span>}
        </Fact>
        <Fact label="App">
          BoringTalks {appLabel(r)}
          {r.app.build && <span className="text-ink-soft"> (build {r.app.build})</span>}
        </Fact>
        <Fact label="System">{[r.system.os, r.system.model].filter(Boolean).join(', ')}</Fact>
        <Fact label="Report id">{r.id}</Fact>
      </dl>

      <section aria-label="Message" className="mt-6">
        <h2 className="text-sm font-extrabold tracking-wide text-ink-soft uppercase">What happened</h2>
        <p className={`mt-2 font-semibold whitespace-pre-wrap ${r.message ? 'text-ink' : 'text-ink-soft italic'}`}>{r.message || 'No message'}</p>
      </section>

      <section aria-label="Diagnostics" className="mt-6">
        <h2 className="text-sm font-extrabold tracking-wide text-ink-soft uppercase">Diagnostics</h2>
        {diagnostics.length === 0 ? (
          <p className="mt-2 font-semibold text-ink-soft italic">None</p>
        ) : (
          <dl className="sticker mt-2 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 px-5 py-4 font-mono text-xs">
            {diagnostics.map(([k, v]) => (
              <Fact key={k} label={k}>
                {v}
              </Fact>
            ))}
          </dl>
        )}
      </section>

      <section aria-label="Log" className="mt-6">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-extrabold tracking-wide text-ink-soft uppercase">Log · {formatBytes(r.logBytes)}</h2>
          {r.log && <CopyButton text={r.log} />}
        </div>
        {r.log ? (
          <pre className="sticker mt-2 max-h-[70vh] overflow-auto px-5 py-4 font-mono text-xs whitespace-pre-wrap">{r.log}</pre>
        ) : (
          <p className="mt-2 font-semibold text-ink-soft italic">Not included</p>
        )}
      </section>
    </>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="font-extrabold text-ink-soft">{label}</dt>
      <dd className="min-w-0 font-semibold break-words text-ink">{children}</dd>
    </>
  );
}

function KindChip({ kind }: { kind: ProblemReportKind }) {
  return kind === 'hang' ? (
    <span className="rounded-full bg-danger px-2 py-0.5 text-xs font-extrabold text-white">hang</span>
  ) : (
    <span className="rounded-full bg-sun-soft px-2 py-0.5 text-xs font-extrabold text-ink">user</span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="text-xs font-extrabold text-call-deep underline underline-offset-2"
      onClick={() =>
        void navigator.clipboard.writeText(text).then(
          () => setCopied(true),
          () => setCopied(false),
        )
      }
    >
      {copied ? 'Copied' : 'Copy log'}
    </button>
  );
}

function AdminsOnly() {
  return (
    <p className="sticker mt-6 px-6 py-10 text-center font-bold text-ink-soft" role="status">
      Only admins can see problem reports.
    </p>
  );
}

const appLabel = (r: Pick<ProblemReportSummary, 'app'>) => `${r.app.version}${r.app.flavor === 'dev' ? ' dev' : ''}`;
