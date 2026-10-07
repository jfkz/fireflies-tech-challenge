'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  BUILD,
  isNewBuild,
  liveBuild,
  parseBuildInfo,
  setLiveBuild,
  subscribeToVersion,
  updatesHeld,
  versionLabel,
  VERSION_PATH,
  type BuildInfo,
} from '@/lib/version';

export const CHECK_EVERY_MS = 5 * 60_000;
/** Coming back to the tab checks at once, but not more often than this. */
const MIN_GAP_MS = 60_000;

const reloadPage = () => window.location.reload();

/**
 * Polls /version.json while the tab is visible (and whenever it becomes visible again).
 * When another deployment is live, asks to reload; "Later" leaves a reload link in the footer.
 */
export function UpdatePrompt({ current = BUILD, intervalMs = CHECK_EVERY_MS, reload = reloadPage }: { current?: BuildInfo; intervalMs?: number; reload?: () => void }) {
  useWatchForNewBuild(current, intervalMs);
  const live = useSyncExternalStore(subscribeToVersion, liveBuild, () => null);
  const held = useSyncExternalStore(subscribeToVersion, updatesHeld, () => false);
  const [dismissed, setDismissed] = useState<string | null>(null);

  return (
    <ConfirmDialog
      open={!!live && !held && dismissed !== live.commit}
      tone="primary"
      title="A new version is out"
      confirmLabel="Reload now"
      cancelLabel="Later"
      onConfirm={reload}
      onCancel={() => setDismissed(live?.commit ?? null)}
    >
      BoringTalks was updated ({live ? versionLabel(live) : ''}). Reload the page to get it. Anything you typed and haven&apos;t saved yet on this
      page will be lost.
    </ConfirmDialog>
  );
}

function useWatchForNewBuild(current: BuildInfo, intervalMs: number) {
  useEffect(() => {
    if (current.commit === 'dev') return;
    let lastCheck = Date.now();
    let cancelled = false;

    const check = async () => {
      if (document.visibilityState === 'hidden') return;
      lastCheck = Date.now();
      try {
        const res = await fetch(VERSION_PATH, { cache: 'no-store' });
        if (!res.ok) return;
        const info = parseBuildInfo(await res.json());
        if (!cancelled && info && isNewBuild(info, current)) setLiveBuild(info);
      } catch {
        // Offline or mid-deploy: the next check will tell.
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastCheck >= MIN_GAP_MS) void check();
    };

    const timer = setInterval(() => void check(), intervalMs);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
    };
  }, [current, intervalMs]);
}

/** "v0.2.0 · abc1234", or a reload link once a newer version is live. */
export function VersionTag({ className = '', current = BUILD, reload = reloadPage }: { className?: string; current?: BuildInfo; reload?: () => void }) {
  const live = useSyncExternalStore(subscribeToVersion, liveBuild, () => null);
  return (
    <span className={`text-xs font-bold tabular-nums ${className}`}>
      <span title={`Web app ${current.version}, commit ${current.commit}`}>{versionLabel(current)}</span>
      {live && (
        <>
          {' · '}
          <button type="button" onClick={reload} className="font-extrabold underline underline-offset-2">
            New version: reload
          </button>
        </>
      )}
    </span>
  );
}
