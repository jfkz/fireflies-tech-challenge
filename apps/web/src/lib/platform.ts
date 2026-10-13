import type { DownloadPlatform } from '@boringtalks/shared';

/** The desktop app that fits the visitor's computer, or `other` (phone, tablet, Linux). */
export type Platform = DownloadPlatform | 'other';

/** The bits of `navigator` this reads, so tests can pass plain objects. */
export type NavigatorLike = {
  userAgent: string;
  maxTouchPoints?: number;
  userAgentData?: { platform?: string; mobile?: boolean };
};

/**
 * Which desktop app to offer. The user agent comes first: browsers that freeze it still keep the
 * Windows/Mac token, and iPads ask for desktop sites as a Mac, which only touch points give away.
 */
export function detectPlatform(nav: NavigatorLike): Platform {
  const ua = nav.userAgent;
  if (nav.userAgentData?.mobile || /Android|iPhone|iPad|iPod/i.test(ua)) return 'other';
  if (/Windows NT/i.test(ua)) return 'windows';
  if (/Macintosh|Mac OS X/i.test(ua)) return (nav.maxTouchPoints ?? 0) > 1 ? 'other' : 'macos';
  const hint = nav.userAgentData?.platform?.toLowerCase();
  if (hint === 'windows') return 'windows';
  if (hint === 'macos') return 'macos';
  return 'other';
}

export const PLATFORM_NAME: Record<DownloadPlatform, string> = { macos: 'Mac', windows: 'Windows' };

/** The other desktop app. */
export function otherPlatform(p: DownloadPlatform): DownloadPlatform {
  return p === 'macos' ? 'windows' : 'macos';
}
