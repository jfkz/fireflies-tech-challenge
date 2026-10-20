'use client';

import { MAX_RECORDING_LIMIT_MINUTES, type AdminPerson } from '@boringtalks/shared';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ErrorNote } from '@/components/ui/ErrorNote';
import { useAdminList, useAdminSettings, useGrantAdmin, useMe, useUpdateAdminSettings, useUpdateAdminUser } from '@/hooks/queries';
import { limitLabel } from '@/lib/admin';
import { formatMeetingDate } from '@/lib/format';

/** Settings for the whole service, and who the admins are. */
export function AdminSettingsView() {
  const me = useMe();
  const admin = me.data?.isAdmin === true;
  return (
    <div>
      <h1 className="font-display text-4xl leading-none sm:text-5xl">Settings</h1>
      <div className="mt-6 grid gap-6 lg:grid-cols-2 lg:items-start">
        <GlobalLimit enabled={admin} />
        <Admins enabled={admin} myId={me.data?.id} />
      </div>
    </div>
  );
}

function GlobalLimit({ enabled }: { enabled: boolean }) {
  const settings = useAdminSettings(enabled);
  if (settings.isError) return <ErrorNote onRetry={() => settings.refetch()}>{settings.error.message}</ErrorNote>;
  return (
    <section className="sticker p-5" aria-label="Recording limit">
      <h2 className="text-sm font-extrabold tracking-wide text-ink-soft uppercase">Recording limit</h2>
      <p className="mt-2 text-sm font-semibold text-ink">
        The longest recording the Mac, Windows and browser recorders allow. They warn 5 minutes before it and then stop and upload what was
        recorded. Users with a limit of their own (set on their page) keep it.
      </p>
      {settings.data ? (
        <>
          <p className="mt-3 text-sm font-bold text-ink-soft">
            Now: {limitLabel(settings.data.recordingLimitMinutes)}
            {settings.data.updatedBy && settings.data.updatedAt && ` · changed by ${settings.data.updatedBy} ${formatMeetingDate(settings.data.updatedAt)}`}
          </p>
          {/* Keyed by the saved value, so the form starts from it whenever it changes. */}
          <LimitForm key={settings.data.recordingLimitMinutes} current={settings.data.recordingLimitMinutes} />
        </>
      ) : (
        <div className="mt-3 h-10 animate-pulse rounded-2xl bg-paper" aria-busy="true" />
      )}
    </section>
  );
}

function LimitForm({ current }: { current: number }) {
  const update = useUpdateAdminSettings();
  const [value, setValue] = useState(String(current || 120));
  const [off, setOff] = useState(current === 0);
  const minutes = Number(value);
  const valid = off || (Number.isInteger(minutes) && minutes >= 1 && minutes <= MAX_RECORDING_LIMIT_MINUTES);

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (valid) update.mutate({ recordingLimitMinutes: off ? 0 : minutes });
  };

  return (
    <form onSubmit={save}>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm font-bold">
        <input
          type="number"
          min={1}
          max={MAX_RECORDING_LIMIT_MINUTES}
          className="field w-28 py-1.5 text-sm"
          aria-label="Minutes"
          value={value}
          disabled={off}
          onChange={(e) => setValue(e.target.value)}
        />
        minutes
        <label className="ml-3 flex items-center gap-2">
          <input type="checkbox" className="check" checked={off} onChange={(e) => setOff(e.target.checked)} /> No limit
        </label>
      </div>
      {!valid && <p className="mt-2 text-xs font-bold text-danger">Between 1 and {MAX_RECORDING_LIMIT_MINUTES} minutes.</p>}
      {update.isError && <p className="mt-2 text-xs font-bold text-danger">{update.error.message}</p>}
      <button type="submit" className="btn btn-secondary btn-sm mt-3" disabled={!valid || update.isPending}>
        {update.isPending ? 'Saving…' : 'Save'}
      </button>
    </form>
  );
}

function Admins({ enabled, myId }: { enabled: boolean; myId: string | undefined }) {
  const list = useAdminList(enabled);
  const grant = useGrantAdmin();
  const [email, setEmail] = useState('');

  const add = (e: FormEvent) => {
    e.preventDefault();
    const value = email.trim();
    if (value) grant.mutate(value, { onSuccess: () => setEmail('') });
  };

  return (
    <section className="sticker overflow-hidden" aria-label="Admins">
      <h2 className="border-b-2 border-ink/10 px-5 py-3 text-sm font-extrabold tracking-wide text-ink-soft uppercase">Admins</h2>
      {list.isError ? (
        <div className="p-5">
          <ErrorNote onRetry={() => list.refetch()}>{list.error.message}</ErrorNote>
        </div>
      ) : !list.data ? (
        <div className="m-5 h-24 animate-pulse rounded-2xl bg-paper" aria-busy="true" />
      ) : (
        <ul className="divide-y-2 divide-ink/10" aria-label="Admin list">
          {list.data.admins.map((a) => (
            <AdminRow key={a.id ?? a.email} person={a} self={a.id === myId} />
          ))}
        </ul>
      )}
      <form onSubmit={add} className="border-t-2 border-ink/10 p-5">
        <label htmlFor="new-admin" className="text-sm font-extrabold text-ink">
          Add an admin
        </label>
        <p className="text-xs font-bold text-ink-soft">Their account must exist: they sign in to BoringTalks once first.</p>
        <div className="mt-2 flex items-center gap-2">
          <input
            id="new-admin"
            type="email"
            className="field min-w-0 flex-1 py-1.5 text-sm"
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button type="submit" className="btn btn-primary btn-sm" disabled={grant.isPending || !email.trim()}>
            {grant.isPending ? 'Adding…' : 'Add'}
          </button>
        </div>
        {grant.isError && (
          <p className="mt-2 text-xs font-bold text-danger" role="alert">
            {grant.error.message}
          </p>
        )}
      </form>
    </section>
  );
}

function AdminRow({ person: a, self }: { person: AdminPerson; self: boolean }) {
  const update = useUpdateAdminUser(a.id ?? '');
  const [asking, setAsking] = useState(false);
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-sm">
      {a.id ? (
        <Link href={`/admin/users/${a.id}`} className="font-extrabold text-ink underline decoration-ink/20 underline-offset-2 hover:decoration-ink">
          {a.email}
        </Link>
      ) : (
        <span className="font-extrabold text-ink">{a.email}</span>
      )}
      {a.isOwner ? (
        <span className="rounded-full bg-ink px-2 py-0.5 text-xs font-extrabold text-white">owner</span>
      ) : (
        <span className="rounded-full bg-sun px-2 py-0.5 text-xs font-extrabold text-ink">admin</span>
      )}
      {!a.id && <span className="text-xs font-bold text-ink-soft">hasn’t signed in yet</span>}
      {self && <span className="text-xs font-bold text-ink-soft">you</span>}
      {!a.isOwner && !self && a.id && (
        <button type="button" className="ml-auto text-xs font-extrabold text-danger underline underline-offset-2" onClick={() => setAsking(true)}>
          Remove
        </button>
      )}
      <ConfirmDialog
        open={asking}
        title={`Remove ${a.email ?? 'this admin'}’s admin rights?`}
        confirmLabel="Remove"
        busy={update.isPending}
        error={update.error?.message}
        onCancel={() => {
          setAsking(false);
          update.reset();
        }}
        onConfirm={() => update.mutate({ isAdmin: false }, { onSuccess: () => setAsking(false) })}
      >
        They lose the admin dashboard at once.
      </ConfirmDialog>
    </li>
  );
}
