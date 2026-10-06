'use client';

import type { LatestDownload } from '@boringtalks/shared';
import Link from 'next/link';
import { Avatar } from '@/components/avatar/Avatar';
import { AppIcon } from '@/components/brand/AppIcon';
import { useLatestDownload } from '@/hooks/queries';
import { stillPose } from '@/lib/avatar/pose';
import { TALKER } from '@/lib/avatar/styles';
import { formatBytes } from '@/lib/format';
import { DownloadGlyph } from './MeetingStory';

/** "26.0" → "macOS 26 or later" */
export function minimumOsLabel(minimumOs: string): string {
  const v = minimumOs.replace(/^macOS\s*/i, '').replace(/(\.0)+$/, '');
  return `macOS ${v} or later`;
}

/** The download card, fed by GET /downloads/latest. */
export function DownloadSection() {
  const { data, isPending, isError } = useLatestDownload();
  return (
    <section id="download" aria-labelledby="download-title" className="scroll-mt-4 bg-call px-4 py-24 sm:px-8 sm:py-32">
      <div className="mx-auto max-w-[1100px]">
        <h2 id="download-title" className="font-display max-w-[16ch] text-[2.6rem] leading-[1] text-white sm:text-6xl lg:text-7xl">
          Put a notetaker on your Mac.
        </h2>
        <p className="mt-4 max-w-[55ch] text-lg leading-relaxed font-semibold text-white/90">
          It lives in the menu bar, records when you tell it to, and stays out of the way the rest of the time. It’s free.
        </p>
        <div className="sticker mt-10 grid gap-8 p-6 sm:p-9 lg:grid-cols-[1fr_1fr] lg:gap-12" style={{ boxShadow: 'var(--shadow-hard-lg)' }}>
          {isPending ? <CardSkeleton /> : data ? <Available download={data} /> : <ComingSoon failed={isError} />}
          <FirstLaunch notarized={data?.notarized ?? true} />
        </div>
      </div>
    </section>
  );
}

function Available({ download }: { download: LatestDownload }) {
  return (
    <div>
      <div className="flex items-center gap-5">
        <AppIcon className="h-24 w-24 shrink-0 sm:h-28 sm:w-28" />
        <div>
          <h3 className="font-display text-3xl leading-none text-ink sm:text-4xl">BoringTalks for Mac</h3>
          <p className="mt-2 font-bold text-ink-soft">
            Version {download.version} ({download.build})
          </p>
        </div>
      </div>
      <dl className="mt-6 grid grid-cols-2 gap-3 text-sm">
        <Spec label="Requires" value={minimumOsLabel(download.minimumOs)} />
        <Spec label="Runs on" value="Apple silicon & Intel" />
        <Spec label="Download" value={`${formatBytes(download.sizeBytes)} disk image`} />
        <Spec label="Released" value={new Date(download.publishedAt).toLocaleDateString('en-US', { dateStyle: 'medium' })} />
      </dl>
      <a href={download.url} className="btn btn-primary btn-lg mt-7 w-full sm:w-auto" data-testid="download-dmg" download>
        <DownloadGlyph /> Download for Mac
      </a>
      <p className="mt-3 text-sm font-semibold text-ink-soft">
        No Mac? <Link href="/signup" className="font-extrabold text-call-deep underline underline-offset-2">Record in the browser</Link> instead.
      </p>
    </div>
  );
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border-2 border-ink/15 bg-paper px-3.5 py-2.5">
      <dt className="text-xs font-extrabold text-ink-soft">{label}</dt>
      <dd className="mt-0.5 font-extrabold text-ink">{value}</dd>
    </div>
  );
}

function ComingSoon({ failed }: { failed: boolean }) {
  return (
    <div data-testid="download-coming-soon">
      <div className="flex items-end gap-4">
        <Avatar style={TALKER} pose={stillPose({ emotion: 'sad' })} className="h-28 w-28 shrink-0" />
        <h3 className="font-display text-3xl leading-none text-ink sm:text-4xl">The Mac app is still in the oven.</h3>
      </div>
      <p className="mt-5 leading-relaxed font-semibold text-ink-soft">
        {failed
          ? 'We couldn’t check for the latest build just now. Try again in a minute.'
          : 'The first build hasn’t shipped yet. Until it does, you can record or upload a meeting right in the browser and get the same summary.'}
      </p>
      <Link href="/signup" className="btn btn-primary btn-lg mt-6">
        Record in the browser
      </Link>
    </div>
  );
}

function CardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Checking for the latest version">
      <div className="flex items-center gap-5">
        <div className="h-24 w-24 animate-pulse rounded-[22px] bg-call-light" />
        <div className="h-8 w-56 animate-pulse rounded-full bg-paper" />
      </div>
      <div className="mt-6 grid grid-cols-2 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-2xl bg-paper" />
        ))}
      </div>
    </div>
  );
}

function FirstLaunch({ notarized }: { notarized: boolean }) {
  return (
    <div className="rounded-[20px] bg-sun-soft p-5 sm:p-6">
      <h3 className="text-xl font-extrabold text-ink">The first launch</h3>
      <ol className="mt-4 space-y-3.5 text-[0.97rem] leading-relaxed font-semibold text-ink">
        <Step n={1}>Open the disk image and drag BoringTalks into Applications.</Step>
        {!notarized && (
          <Step n={2}>
            This build isn’t notarized by Apple yet, so the first time, <strong>right-click the app and choose Open</strong>, then Open again. After
            that it opens normally.
          </Step>
        )}
        <Step n={notarized ? 2 : 3}>
          Allow <strong>Microphone</strong> when asked. That’s your side of the call.
        </Step>
        <Step n={notarized ? 3 : 4}>
          Allow <strong>System Audio Recording</strong> (System Settings, Privacy & Security, Screen & System Audio Recording). That’s everyone
          else.
        </Step>
        <Step n={notarized ? 4 : 5}>Click the menu bar icon and sign in. Your browser opens this site to connect the Mac to your account.</Step>
      </ol>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="font-display grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 border-ink bg-white text-sm" aria-hidden>
        {n}
      </span>
      <span>{children}</span>
    </li>
  );
}
