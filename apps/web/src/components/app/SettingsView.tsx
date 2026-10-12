'use client';

import type { Device, DownloadPlatform } from '@boringtalks/shared';
import Link from 'next/link';
import { useId, useState } from 'react';
import { AppIcon } from '@/components/brand/AppIcon';
import { useAuth } from '@/components/providers/AuthProvider';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ErrorNote } from '@/components/ui/ErrorNote';
import { Switch } from '@/components/ui/Switch';
import { useDevices, useDownloads, useMe, useRevokeDevice, useUpdateSettings } from '@/hooks/queries';
import { usePlatform } from '@/hooks/usePlatform';
import { formatMeetingDate } from '@/lib/format';
import { minimumOsLabel } from '@/lib/landing/downloads';
import { PLATFORM_NAME } from '@/lib/platform';

export function SettingsView() {
  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-4xl leading-none sm:text-5xl">Settings</h1>
      <div className="mt-8 space-y-6">
        <AccountSection />
        <NameSection />
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

/** The name transcripts use for you (speaker "You"); changing it updates past meetings too. */
function NameSection() {
  const me = useMe();
  const update = useUpdateSettings();
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? me.data?.name ?? '';
  const changed = value.trim() !== '' && value.trim() !== (me.data?.name ?? '');
  return (
    <Card title="Your name">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (changed) update.mutate({ name: value.trim() }, { onSuccess: () => setDraft(null) });
        }}
      >
        <label htmlFor="your-name" className="min-w-0 flex-1">
          <span className="block font-extrabold">What should meetings call you?</span>
          <span className="block text-sm font-semibold text-ink-soft">Your side of the call shows up under your first name instead of “You”, in new and past meetings.</span>
          <input
            id="your-name"
            className="field mt-2"
            value={value}
            maxLength={80}
            autoComplete="name"
            placeholder="e.g. Maya Chen"
            disabled={!me.data}
            onChange={(e) => setDraft(e.target.value)}
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={!changed || update.isPending}>
          {update.isPending ? 'Saving…' : update.isSuccess && !changed ? 'Saved' : 'Save'}
        </button>
      </form>
      {update.isError && (
        <div className="mt-3">
          <ErrorNote>{update.error.message}</ErrorNote>
        </div>
      )}
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
    <Card title="Connected computers">
      {devices.isPending ? (
        <div className="h-16 animate-pulse rounded-2xl bg-paper" aria-busy="true" />
      ) : devices.isError ? (
        <ErrorNote onRetry={() => devices.refetch()}>{devices.error.message}</ErrorNote>
      ) : devices.data.length === 0 ? (
        <p className="font-semibold text-ink-soft">
          No computers connected yet. Install the Mac or Windows app and choose Sign in from its menu; it opens this site to connect.
        </p>
      ) : (
        <ul className="divide-y-2 divide-ink/10" aria-label="Connected computers">
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
        title={`Disconnect ${target?.name ?? 'this computer'}?`}
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
  const downloads = useDownloads();
  const platform = usePlatform();
  // The visitor's own computer first.
  const order: DownloadPlatform[] = platform === 'windows' ? ['windows', 'macos'] : ['macos', 'windows'];
  return (
    <Card title="Desktop app">
      <p className="font-semibold text-ink-soft">Records both sides of a call and transcribes on your computer.</p>
      <ul className="mt-4 divide-y-2 divide-ink/10">
        {order.map((p) => {
          const build = downloads.data?.[p];
          return (
            <li key={p} className="flex flex-wrap items-center gap-4 py-3 first:pt-0 last:pb-0">
              <AppIcon className="h-12 w-12 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-extrabold">BoringTalks for {PLATFORM_NAME[p]}</p>
                <p className="text-sm font-semibold text-ink-soft">
                  {build ? `Version ${build.version} for ${minimumOsLabel(p, build.minimumOs)}.` : downloads.isPending ? 'Checking…' : 'Not released yet.'}
                </p>
              </div>
              {build ? (
                <a href={build.url} className="btn btn-primary" download>
                  Download
                </a>
              ) : (
                <Link href="/#download" className="btn btn-secondary">
                  Details
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
