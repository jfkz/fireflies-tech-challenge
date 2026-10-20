'use client';

import { MAX_RECORDING_LIMIT_MINUTES, type AdminUserDetail } from '@boringtalks/shared';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ErrorNote } from '@/components/ui/ErrorNote';
import { useAdminUser, useMe, useUpdateAdminUser } from '@/hooks/queries';
import { appLabel, limitLabel, minutes, SOURCE_LABELS, STATUS_LABELS } from '@/lib/admin';
import { formatBytes, formatMeetingDate } from '@/lib/format';
import { Badges } from './AdminUsersView';

/** One account: what they use, their computers, their meetings (no titles), reports, rights and limit. */
export function AdminUserView({ id }: { id: string }) {
  const me = useMe();
  const user = useAdminUser(id, me.data?.isAdmin === true);

  return (
    <div>
      <Link href="/admin/users" className="text-sm font-extrabold text-call-deep underline underline-offset-2">
        ← All users
      </Link>
      {user.isError ? (
        <div className="mt-6">
          <ErrorNote onRetry={() => user.refetch()}>{user.error.message}</ErrorNote>
        </div>
      ) : !user.data ? (
        <div className="sticker mt-6 h-64 animate-pulse" aria-busy="true" aria-label="Loading the user" />
      ) : (
        <UserDetail user={user.data} self={user.data.id === me.data?.id} />
      )}
    </div>
  );
}

function UserDetail({ user: u, self }: { user: AdminUserDetail; self: boolean }) {
  return (
    <>
      <h1 className="font-display mt-3 flex flex-wrap items-center gap-3 text-4xl leading-none break-all">
        {u.email ?? u.id} <Badges user={u} />
      </h1>
      <p className="mt-2 font-semibold text-ink-soft">
        {u.name ?? 'No name'} · joined {formatMeetingDate(u.createdAt)} · {u.lastActiveAt ? `active ${formatMeetingDate(u.lastActiveAt)}` : 'never active'}
      </p>

      <dl className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Meetings" value={String(u.meetingCount)} detail={minutes(u.recordedMinutes)} />
        <Stat label="Last 30 days" value={String(u.last30d.meetings)} detail={minutes(u.last30d.recordedMinutes)} />
        <Stat label="Failed, 30 days" value={String(u.last30d.failed)} detail={`of ${u.last30d.meetings}`} />
        <Stat label="Recording limit" value={u.effectiveRecordingLimitMinutes === null ? 'None' : minutes(u.effectiveRecordingLimitMinutes)} detail={u.recordingLimitMinutes === null ? 'the default' : 'set for them'} />
      </dl>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <AdminRights user={u} self={self} />
        <LimitControl user={u} />
      </div>

      <section className="sticker mt-6 overflow-hidden" aria-label="Computers">
        <h2 className="border-b-2 border-ink/10 px-5 py-3 text-sm font-extrabold tracking-wide text-ink-soft uppercase">Computers</h2>
        {u.devices.length === 0 ? (
          <p className="px-5 py-4 text-sm font-semibold text-ink-soft">No desktop app connected.</p>
        ) : (
          <ul className="divide-y-2 divide-ink/10">
            {u.devices.map((d) => (
              <li key={d.id} className={`flex flex-wrap gap-x-3 px-5 py-3 text-sm ${d.revokedAt ? 'opacity-60' : ''}`}>
                <span className="font-extrabold text-ink">{d.name}</span>
                <span className="font-bold text-ink-soft">{appLabel(d.platform, d.appVersion)}</span>
                <span className="ml-auto font-bold text-ink-soft">
                  {d.revokedAt ? `disconnected ${formatMeetingDate(d.revokedAt)}` : d.lastSeenAt ? `seen ${formatMeetingDate(d.lastSeenAt)}` : 'never seen'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="sticker mt-6 overflow-hidden" aria-label="Meetings">
        <h2 className="border-b-2 border-ink/10 px-5 py-3 text-sm font-extrabold tracking-wide text-ink-soft uppercase">
          Latest meetings <span className="normal-case">(no titles or transcripts)</span>
        </h2>
        {u.meetings.length === 0 ? (
          <p className="px-5 py-4 text-sm font-semibold text-ink-soft">No meetings yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm tabular-nums">
              <thead className="text-xs text-ink-soft uppercase">
                <tr>
                  <th className="px-5 py-2">Started</th>
                  <th className="px-3 py-2">From</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Length</th>
                  <th className="px-5 py-2">Audio</th>
                </tr>
              </thead>
              <tbody className="font-semibold">
                {u.meetings.map((m) => (
                  <tr key={m.id} className="border-t border-ink/10 align-top">
                    <td className="px-5 py-2 whitespace-nowrap">{formatMeetingDate(m.startedAt)}</td>
                    <td className="px-3 py-2">{SOURCE_LABELS[m.source]}</td>
                    <td className={`px-3 py-2 ${m.status === 'failed' ? 'text-danger' : ''}`} title={m.error ?? undefined}>
                      {STATUS_LABELS[m.status]}
                    </td>
                    <td className="px-3 py-2">{m.durationSec === null ? '—' : minutes(Math.round(m.durationSec / 60))}</td>
                    <td className="px-5 py-2">{m.audioBytes === null ? '—' : formatBytes(m.audioBytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="sticker mt-6 overflow-hidden" aria-label="Problem reports">
        <h2 className="border-b-2 border-ink/10 px-5 py-3 text-sm font-extrabold tracking-wide text-ink-soft uppercase">Problem reports</h2>
        {u.reports.length === 0 ? (
          <p className="px-5 py-4 text-sm font-semibold text-ink-soft">None sent.</p>
        ) : (
          <ul className="divide-y-2 divide-ink/10">
            {u.reports.map((r) => (
              <li key={r.id}>
                <Link href={`/admin/reports/${r.id}`} className="flex flex-wrap gap-x-3 px-5 py-3 text-sm hover:bg-paper">
                  <span className="font-extrabold text-ink">{r.kind === 'hang' ? 'Hang' : 'Report'}</span>
                  <span className="min-w-0 flex-1 truncate font-semibold text-ink-soft">{r.message.split('\n')[0] || 'No message'}</span>
                  <span className="font-bold text-ink-soft">{formatMeetingDate(r.createdAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="sticker px-4 py-3">
      <dt className="text-xs font-extrabold tracking-wide text-ink-soft uppercase">{label}</dt>
      <dd className="mt-1 text-2xl leading-none font-extrabold text-ink tabular-nums">{value}</dd>
      <dd className="mt-1 text-sm font-bold text-ink-soft">{detail}</dd>
    </div>
  );
}

function AdminRights({ user: u, self }: { user: AdminUserDetail; self: boolean }) {
  const update = useUpdateAdminUser(u.id);
  const [asking, setAsking] = useState(false);
  const making = !u.isAdmin;
  return (
    <section className="sticker p-5" aria-label="Admin rights">
      <h2 className="text-sm font-extrabold tracking-wide text-ink-soft uppercase">Admin rights</h2>
      <p className="mt-2 text-sm font-semibold text-ink">
        {u.isOwner
          ? 'An owner (ADMIN_EMAILS on the API). Owners are always admins; change that on the server.'
          : u.isAdmin
            ? `An admin${u.adminGrantedBy ? `, made one by ${u.adminGrantedBy.email ?? 'an admin'}` : ''}. Admins see every account and its usage, and can change limits and admins.`
            : 'Not an admin.'}
      </p>
      {!u.isOwner && !(self && u.isAdmin) && (
        <button type="button" className={`btn btn-sm mt-3 ${making ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setAsking(true)}>
          {making ? 'Make admin' : 'Remove admin rights'}
        </button>
      )}
      {self && u.isAdmin && !u.isOwner && <p className="mt-2 text-xs font-bold text-ink-soft">You can’t remove your own admin rights.</p>}
      <ConfirmDialog
        open={asking}
        title={making ? `Make ${u.email ?? 'this user'} an admin?` : `Remove ${u.email ?? 'this user'}’s admin rights?`}
        confirmLabel={making ? 'Make admin' : 'Remove'}
        tone={making ? 'primary' : 'danger'}
        busy={update.isPending}
        error={update.error?.message}
        onCancel={() => {
          setAsking(false);
          update.reset();
        }}
        onConfirm={() => update.mutate({ isAdmin: making }, { onSuccess: () => setAsking(false) })}
      >
        {making ? 'They will see every account, its usage and problem reports, and can change limits and admins.' : 'They lose the admin dashboard at once.'}
      </ConfirmDialog>
    </section>
  );
}

type LimitChoice = 'default' | 'custom' | 'none';

function LimitControl({ user: u }: { user: AdminUserDetail }) {
  const update = useUpdateAdminUser(u.id);
  const initial: LimitChoice = u.recordingLimitMinutes === null ? 'default' : u.recordingLimitMinutes === 0 ? 'none' : 'custom';
  const [choice, setChoice] = useState<LimitChoice>(initial);
  const [value, setValue] = useState(String(u.recordingLimitMinutes || u.effectiveRecordingLimitMinutes || 120));
  const minutesValue = Number(value);
  const valid = choice !== 'custom' || (Number.isInteger(minutesValue) && minutesValue >= 1 && minutesValue <= MAX_RECORDING_LIMIT_MINUTES);

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    update.mutate({ recordingLimitMinutes: choice === 'default' ? null : choice === 'none' ? 0 : minutesValue });
  };

  return (
    <form className="sticker p-5" aria-label="Recording limit" onSubmit={save}>
      <h2 className="text-sm font-extrabold tracking-wide text-ink-soft uppercase">Recording limit</h2>
      <p className="mt-2 text-sm font-semibold text-ink">
        The longest recording their apps allow. Now: {limitLabel(u.recordingLimitMinutes, u.effectiveRecordingLimitMinutes)}.
      </p>
      <fieldset className="mt-3 space-y-1.5 text-sm font-bold">
        <legend className="sr-only">Limit</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="limit" checked={choice === 'default'} onChange={() => setChoice('default')} /> The default for everyone
        </label>
        <label className="flex flex-wrap items-center gap-2">
          <input type="radio" name="limit" checked={choice === 'custom'} onChange={() => setChoice('custom')} /> Their own:
          <input
            type="number"
            min={1}
            max={MAX_RECORDING_LIMIT_MINUTES}
            className="field w-24 py-1 text-sm"
            aria-label="Minutes"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setChoice('custom');
            }}
          />
          minutes
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="limit" checked={choice === 'none'} onChange={() => setChoice('none')} /> No limit
        </label>
      </fieldset>
      {!valid && <p className="mt-2 text-xs font-bold text-danger">Between 1 and {MAX_RECORDING_LIMIT_MINUTES} minutes.</p>}
      {update.isError && <p className="mt-2 text-xs font-bold text-danger">{update.error.message}</p>}
      <button type="submit" className="btn btn-secondary btn-sm mt-3" disabled={!valid || update.isPending}>
        {update.isPending ? 'Saving…' : update.isSuccess ? 'Saved' : 'Save limit'}
      </button>
    </form>
  );
}
