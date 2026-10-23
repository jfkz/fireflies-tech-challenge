'use client';

import type { DownloadPlatform, Downloads, LatestDownload } from '@boringtalks/shared';
import Link from 'next/link';
import { analytics } from '@/lib/analytics';
import { Avatar } from '@/components/avatar/Avatar';
import { AppIcon } from '@/components/brand/AppIcon';
import { useDownloads } from '@/hooks/queries';
import { usePlatform } from '@/hooks/usePlatform';
import { stillPose } from '@/lib/avatar/pose';
import { TALKER } from '@/lib/avatar/styles';
import { formatBytes } from '@/lib/format';
import { chooseDownloads, fileName, minimumOsLabel, type DownloadChoice } from '@/lib/landing/downloads';
import { PLATFORM_NAME } from '@/lib/platform';
import { DownloadGlyph } from './MeetingStory';

const COMPUTER: Record<DownloadPlatform, string> = { macos: 'Mac', windows: 'PC' };
const RUNS_ON: Record<DownloadPlatform, string> = { macos: 'Apple silicon & Intel', windows: '64-bit PCs (x64)' };
const FILE_KIND: Record<DownloadPlatform, string> = { macos: 'disk image', windows: 'installer' };
const TEST_ID: Record<DownloadPlatform, string> = { macos: 'download-dmg', windows: 'download-exe' };

/** The download card, fed by GET /downloads and pointed at the visitor's own computer. */
export function DownloadSection() {
  const { data, isPending, isError } = useDownloads();
  const platform = usePlatform();
  const choice = data ? chooseDownloads(platform, data) : null;
  const where = choice?.primary ? COMPUTER[choice.primary] : 'computer';
  return (
    <section id="download" aria-labelledby="download-title" className="scroll-mt-4 bg-call px-4 py-24 sm:px-8 sm:py-32">
      <div className="mx-auto max-w-[1100px]">
        <h2 id="download-title" className="font-display max-w-[16ch] text-[2.6rem] leading-[1] text-white sm:text-6xl lg:text-7xl">
          Put a notetaker on your {where}.
        </h2>
        <p className="mt-4 max-w-[55ch] text-lg leading-relaxed font-semibold text-white/90">
          It lives in the menu bar on a Mac and the system tray on Windows, records when you tell it to, and stays out of the way the rest of the
          time. It’s free.
        </p>
        <div className="sticker mt-10 grid gap-8 p-6 sm:p-9 lg:grid-cols-[1fr_1fr] lg:gap-12" style={{ boxShadow: 'var(--shadow-hard-lg)' }}>
          {isPending ? <CardSkeleton /> : data && choice && (choice.primary || choice.others.length) ? <Offer downloads={data} choice={choice} /> : <ComingSoon failed={isError} />}
        </div>
      </div>
    </section>
  );
}

function Offer({ downloads, choice }: { downloads: Downloads; choice: DownloadChoice }) {
  if (!choice.primary) {
    // No idea which computer this is (a phone, Linux): every app, side by side.
    return (
      <>
        {choice.others.map((p) => (
          <Available key={p} download={downloads[p]!} platform={p} />
        ))}
      </>
    );
  }
  const primary = downloads[choice.primary]!;
  return (
    <>
      <div>
        <Available download={primary} platform={choice.primary} />
        {choice.others.map((p) => (
          <AlsoFor key={p} download={downloads[p]!} platform={p} />
        ))}
      </div>
      <FirstLaunch platform={choice.primary} download={primary} />
    </>
  );
}

function Available({ download, platform }: { download: LatestDownload; platform: DownloadPlatform }) {
  const name = PLATFORM_NAME[platform];
  return (
    <div data-testid={`download-card-${platform}`}>
      <div className="flex items-center gap-5">
        <AppIcon className="h-24 w-24 shrink-0 sm:h-28 sm:w-28" />
        <div>
          <h3 className="font-display text-3xl leading-none text-ink sm:text-4xl">BoringTalks for {name}</h3>
          <p className="mt-2 font-bold text-ink-soft">
            Version {download.version} ({download.build})
          </p>
        </div>
      </div>
      <dl className="mt-6 grid grid-cols-2 gap-3 text-sm">
        <Spec label="Requires" value={minimumOsLabel(platform, download.minimumOs)} />
        <Spec label="Runs on" value={RUNS_ON[platform]} />
        <Spec label="Download" value={`${formatBytes(download.sizeBytes)} ${FILE_KIND[platform]}`} />
        <Spec label="Released" value={new Date(download.publishedAt).toLocaleDateString('en-US', { dateStyle: 'medium' })} />
      </dl>
      <a
        href={download.url}
        className="btn btn-primary btn-lg mt-7 w-full sm:w-auto"
        data-testid={TEST_ID[platform]}
        download
        onClick={() => analytics.track('download_clicked', { platform, where: 'card' })}
      >
        <DownloadGlyph /> Download for {name}
      </a>
      <p className="mt-3 text-sm font-semibold text-ink-soft">
        Not at your computer? <Link href="/signup" className="font-extrabold text-call-deep underline underline-offset-2">Record in the browser</Link> instead.
      </p>
    </div>
  );
}

/** A one-line offer of the other desktop app, under the main card. */
function AlsoFor({ download, platform }: { download: LatestDownload; platform: DownloadPlatform }) {
  return (
    <p className="mt-6 flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-2xl border-2 border-ink/15 bg-paper px-4 py-3 text-sm font-semibold text-ink-soft">
      <span className="font-extrabold text-ink">Also for {PLATFORM_NAME[platform]}:</span>
      <span>
        version {download.version}, {formatBytes(download.sizeBytes)} {FILE_KIND[platform]}, {minimumOsLabel(platform, download.minimumOs)}.
      </span>
      <a
        href={download.url}
        className="font-extrabold text-call-deep underline underline-offset-2"
        data-testid={TEST_ID[platform]}
        download
        onClick={() => analytics.track('download_clicked', { platform, where: 'card-also' })}
      >
        Download for {PLATFORM_NAME[platform]}
      </a>
    </p>
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
        <h3 className="font-display text-3xl leading-none text-ink sm:text-4xl">The desktop app is still in the oven.</h3>
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

function FirstLaunch({ platform, download }: { platform: DownloadPlatform; download: LatestDownload }) {
  const steps = platform === 'windows' ? windowsSteps(download.notarized, fileName(download.url)) : macSteps(download.notarized);
  return (
    <div className="rounded-[20px] bg-sun-soft p-5 sm:p-6" data-testid={`first-launch-${platform}`}>
      <h3 className="text-xl font-extrabold text-ink">The first launch</h3>
      <ol className="mt-4 space-y-3.5 text-[0.97rem] leading-relaxed font-semibold text-ink">
        {steps.map((step, i) => (
          <Step key={i} n={i + 1}>
            {step}
          </Step>
        ))}
      </ol>
    </div>
  );
}

function macSteps(notarized: boolean): React.ReactNode[] {
  return [
    'Open the disk image and drag BoringTalks into Applications.',
    !notarized && (
      <>
        This build isn’t notarized by Apple yet, so the first time, <strong>right-click the app and choose Open</strong>, then Open again. After that
        it opens normally.
      </>
    ),
    <>
      Allow <strong>Microphone</strong> when asked. That’s your side of the call.
    </>,
    <>
      Allow <strong>System Audio Recording</strong> (System Settings, Privacy & Security, Screen & System Audio Recording). That’s everyone else.
    </>,
    'Click the menu bar icon and sign in. Your browser opens this site to connect the Mac to your account.',
  ].filter(Boolean);
}

function windowsSteps(signed: boolean, file: string): React.ReactNode[] {
  return [
    `Run ${file || 'the installer'}. It installs just for you, no admin rights needed.`,
    !signed && (
      <>
        This build isn’t code-signed yet. If your browser says the file isn’t commonly downloaded, choose <strong>Keep</strong>. If Windows says it
        protected your PC, click <strong>More info</strong>, then <strong>Run anyway</strong>. You only do this once.
      </>
    ),
    <>
      Click the BoringTalks icon in the system tray (under <strong>^</strong> if it’s hidden) and sign in. Your browser opens this site to connect
      the PC to your account; allow it to <strong>Open BoringTalks</strong>.
    </>,
    <>
      If it can’t hear you, turn on <strong>Let desktop apps access your microphone</strong> (Settings, Privacy & security, Microphone). The
      call’s sound needs no permission.
    </>,
    'The first recording downloads what BoringTalks needs to transcribe (about 700 MB), once. After that, your PC writes meetings down by itself.',
  ].filter(Boolean);
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
