'use client';

import type { Device } from '@boringtalks/shared';
import Link from 'next/link';
import { useId, useState } from 'react';
import { AppIcon } from '@/components/brand/AppIcon';
import { useAuth } from '@/components/providers/AuthProvider';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ErrorNote } from '@/components/ui/ErrorNote';
import { Switch } from '@/components/ui/Switch';
import { useDevices, useLatestDownload, useMe, useRevokeDevice, useUpdateSettings } from '@/hooks/queries';
import { formatMeetingDate } from '@/lib/format';

export function SettingsView() {
  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-4xl leading-none sm:text-5xl">Settings</h1>
      <div className="mt-8 space-y-6">
        <AccountSection />
        <EmailSection />
        <DevicesSection />
        <DownloadCard />
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="sticker p-5 sm:p-6" aria-label={title}>
      <h2 className="font-display text-2xl leading-none">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function AccountSection() {
  const { user, signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const provider = user?.providerData[0]?.providerId === 'google.com' ? 'Google' : 'email and password';
  return (
    <Card title="Account">
      <div className="flex flex-wrap items-center gap-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-extrabold" data-testid="account-email">
            {user?.email ?? 'Signed in'}
          </p>
          <p className="text-sm font-semibold text-ink-soft">Signed in with {provider}</p>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await signOut();
          }}
        >
          Sign out
        </button>
      </div>
    </Card>
  );
}

function EmailSection() {
  const me = useMe();
  const update = useUpdateSettings();
  const id = useId();
  const checked = update.isPending ? (update.variables?.emailOnReady ?? false) : (me.data?.emailOnReady ?? false);
  return (
    <Card title="Email">
      <div className="flex items-center gap-4">
        <label htmlFor={id} className="flex-1 cursor-pointer">
          <span className="block font-extrabold">Email me when a meeting is ready</span>
          <span className="block text-sm font-semibold text-ink-soft">Title, a short summary and your action items, a minute after you hang up.</span>
        </label>
        <Switch id={id} label="Email me when a meeting is ready" checked={checked} disabled={!me.data || update.isPending} onChange={(next) => update.mutate({ emailOnReady: next })} />
      </div>
      {update.isError && (
        <div className="mt-3">
          <ErrorNote>{update.error.message}</ErrorNote>
        </div>
      )}
    </Card>
  );
}

function DevicesSection() {
  const devices = useDevices();
  const revoke = useRevokeDevice();
  const [target, setTarget] = useState<Device | null>(null);
  return (
    <Card title="Connected Macs">
      {devices.isPending ? (
        <div className="h-16 animate-pulse rounded-2xl bg-paper" aria-busy="true" />
      ) : devices.isError ? (
        <ErrorNote onRetry={() => devices.refetch()}>{devices.error.message}</ErrorNote>
      ) : devices.data.length === 0 ? (
        <p className="font-semibold text-ink-soft">
          No Macs connected yet. Install the app and choose Sign in from its menu; it opens this site to connect.
        </p>
      ) : (
        <ul className="divide-y-2 divide-ink/10" aria-label="Connected Macs">
          {devices.data.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
              <span className="grid h-10 w-10 place-items-center rounded-xl border-2 border-ink bg-paper" aria-hidden>
                <svg viewBox="0 0 24 24" className="h-6 w-6">
                  <rect x="3" y="4" width="18" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="2.2" />
                  <path d="M1.5 19.5h21" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                </svg>
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-extrabold">{d.name}</p>
                <p className="text-sm font-semibold text-ink-soft">
                  Connected {formatMeetingDate(d.createdAt)}
                  {d.lastSeenAt ? `, last seen ${formatMeetingDate(d.lastSeenAt)}` : ''}
                </p>
              </div>
              <button type="button" className="btn btn-secondary btn-sm text-danger" onClick={() => setTarget(d)}>
                Disconnect
              </button>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={!!target}
        title={`Disconnect ${target?.name ?? 'this Mac'}?`}
        confirmLabel="Disconnect"
        busy={revoke.isPending}
        error={revoke.isError ? revoke.error.message : null}
        onCancel={() => {
          revoke.reset();
          setTarget(null);
        }}
        onConfirm={() => target && revoke.mutate(target.id, { onSuccess: () => setTarget(null) })}
      >
        It stops uploading right away. Meetings it already sent stay in your account. To use it again, sign in from the app.
      </ConfirmDialog>
    </Card>
  );
}

function DownloadCard() {
  const latest = useLatestDownload();
  return (
    <Card title="Mac app">
      <div className="flex flex-wrap items-center gap-4">
        <AppIcon className="h-14 w-14 shrink-0" />
        <p className="min-w-0 flex-1 font-semibold text-ink-soft">
          {latest.data ? `Version ${latest.data.version} for macOS ${latest.data.minimumOs.replace(/(\.0)+$/, '')} or later.` : 'Records both sides of a call and transcribes on your Mac.'}
        </p>
        {latest.data ? (
          <a href={latest.data.url} className="btn btn-primary">
            Download
          </a>
        ) : (
          <Link href="/#download" className="btn btn-secondary">
            Details
          </Link>
        )}
      </div>
    </Card>
  );
}
