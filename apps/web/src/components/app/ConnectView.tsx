'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { SpeechBubble } from '@/components/avatar/SpeechBubble';
import { TalkingHead } from '@/components/avatar/TalkingHead';
import { AppIcon } from '@/components/brand/AppIcon';
import { useAuth } from '@/components/providers/AuthProvider';
import { ErrorNote } from '@/components/ui/ErrorNote';
import { useAuthorizeDevice } from '@/hooks/queries';
import { TALKER } from '@/lib/avatar/styles';
import { declinedCallbackUrl, isAppCallback, parseConnectParams } from '@/lib/connect';
import type { DeviceApp } from '@boringtalks/shared';

/** Hands the browser over to the Mac app. A function so tests can replace it. */
export function openApp(url: string) {
  window.location.href = url;
}

export function ConnectView({ open = openApp }: { open?: (url: string) => void }) {
  const params = parseConnectParams(useSearchParams());
  if (!params.ok) return <BadLink reason={params.reason} />;
  return <Approve challenge={params.challenge} deviceName={params.deviceName} app={params.app} open={open} />;
}

function Approve({ challenge, deviceName, app, open }: { challenge: string; deviceName: string; app: DeviceApp; open: (url: string) => void }) {
  const { user } = useAuth();
  const authorize = useAuthorizeDevice();
  const [copied, setCopied] = useState(false);
  const [declined, setDeclined] = useState(false);
  const result = authorize.data;

  function decline() {
    setDeclined(true);
    open(declinedCallbackUrl(app));
  }

  function approve() {
    authorize.mutate(
      { codeChallenge: challenge, deviceName: deviceName === 'your Mac' ? 'Mac' : deviceName, ...(app === 'dev' ? { app } : {}) },
      {
        onSuccess: (res) => {
          if (isAppCallback(res.redirectUrl)) open(res.redirectUrl);
        },
      },
    );
  }

  if (declined) {
    return (
      <Card head={<TalkingHead style={TALKER} emotion="sad" seed={3} className="h-32 w-32" />}>
        <h1 className="font-display text-3xl leading-tight sm:text-4xl">Okay, not connected.</h1>
        <p className="mt-3 font-semibold text-ink-soft">We told the app you said no. You can close this tab, or connect later from the app’s menu.</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <a href={declinedCallbackUrl(app)} className="btn btn-secondary">
            Back to the app
          </a>
          <Link href="/meetings" className="btn btn-secondary">
            Go to my meetings
          </Link>
        </div>
      </Card>
    );
  }

  if (result) {
    return (
      <Card head={<TalkingHead style={TALKER} cheering seed={3} className="h-32 w-32" />} bubble="Connected!">
        <h1 className="font-display text-3xl leading-tight sm:text-4xl">You can go back to the app.</h1>
        <p className="mt-3 font-semibold text-ink-soft">
          {deviceName === 'your Mac' ? 'Your Mac' : deviceName} is now signed in as <strong className="text-ink">{user?.email}</strong>. If the app
          didn’t come to the front, open it yourself:
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          {isAppCallback(result.redirectUrl) && (
            <a href={result.redirectUrl} className="btn btn-primary" data-testid="open-app">
              Open {app === 'dev' ? 'BoringTalks Dev' : 'BoringTalks'}
            </a>
          )}
          <Link href="/meetings" className="btn btn-secondary">
            Go to my meetings
          </Link>
        </div>
        <div className="mt-6 rounded-2xl bg-paper p-4">
          <p className="text-sm font-bold text-ink-soft">Still nothing? Paste this code into the app’s sign-in window:</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <code className="rounded-xl border-2 border-ink bg-white px-4 py-2 font-mono text-2xl font-bold tracking-wider break-all select-all" data-testid="device-code">
              {result.code}
            </code>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={async () => {
                await navigator.clipboard.writeText(result.code).catch(() => {});
                setCopied(true);
              }}
            >
              {copied ? 'Copied' : 'Copy code'}
            </button>
          </div>
          <p className="mt-2 text-xs font-semibold text-ink-soft">It works once and expires in {Math.max(1, Math.round(result.expiresInSec / 60))} minutes.</p>
        </div>
      </Card>
    );
  }

  return (
    <Card head={<AppIcon className="h-28 w-28" />}>
      <h1 className="font-display text-3xl leading-tight sm:text-4xl">
        Connect {deviceName} to your BoringTalks account?
      </h1>
      <p className="mt-3 font-semibold text-ink-soft">
        You’re signed in as <strong className="text-ink">{user?.email}</strong>. The Mac app will be able to upload meetings to this account. You can
        disconnect it any time in Settings.
      </p>
      {authorize.isError && (
        <div className="mt-4">
          <ErrorNote>{authorize.error.message}</ErrorNote>
        </div>
      )}
      <div className="mt-6 flex flex-wrap gap-3">
        <button type="button" className="btn btn-primary btn-lg" onClick={approve} disabled={authorize.isPending}>
          {authorize.isPending ? 'Connecting…' : 'Connect this Mac'}
        </button>
        <button type="button" className="btn btn-secondary btn-lg" onClick={decline} disabled={authorize.isPending}>
          Not now
        </button>
      </div>
      <p className="mt-5 text-sm font-semibold text-ink-soft">Didn’t start this from the BoringTalks app? Click Not now.</p>
    </Card>
  );
}

function BadLink({ reason }: { reason: 'missing' | 'invalid' }) {
  return (
    <Card head={<TalkingHead style={TALKER} emotion="surprised" seed={4} className="h-32 w-32" />}>
      <h1 className="font-display text-3xl leading-tight sm:text-4xl">This connect link doesn’t work</h1>
      <p className="mt-3 font-semibold text-ink-soft">
        {reason === 'missing'
          ? 'It’s missing the security code the Mac app adds.'
          : 'The security code in it is damaged, maybe cut off when it was copied.'}{' '}
        Open the BoringTalks menu on your Mac and choose Sign in again; it opens a fresh link.
      </p>
      <Link href="/meetings" className="btn btn-secondary mt-6">
        Go to my meetings
      </Link>
    </Card>
  );
}

function Card({ head, bubble, children }: { head: React.ReactNode; bubble?: string; children: React.ReactNode }) {
  return (
    <div className="sticker mx-auto mt-4 max-w-2xl p-6 sm:p-10">
      <div className="relative mb-5 inline-block">
        {bubble && (
          <div className="absolute bottom-[80%] left-[70%] w-max">
            <SpeechBubble>{bubble}</SpeechBubble>
          </div>
        )}
        {head}
      </div>
      {children}
    </div>
  );
}
