import type { DownloadPlatform, Downloads } from '@boringtalks/shared';
import type { Platform } from '@/lib/platform';

const ORDER: readonly DownloadPlatform[] = ['macos', 'windows'];

export type DownloadChoice = {
  /** The build to put first: the visitor's own, else the only one there is. Null to show them side by side. */
  primary: DownloadPlatform | null;
  /** The other builds, offered underneath (or next to each other when there is no primary). */
  others: DownloadPlatform[];
};

/** Which builds the download card offers, and in what order, for a visitor on `platform`. */
export function chooseDownloads(platform: Platform | 'unknown', downloads: Downloads): DownloadChoice {
  const shipped = ORDER.filter((p) => downloads[p]);
  if (shipped.length === 0) return { primary: null, others: [] };
  const own = platform === 'macos' || platform === 'windows' ? platform : null;
  // A Windows visitor before the Windows app ships still gets the Mac app first, as before.
  const primary = own && shipped.includes(own) ? own : own || shipped.length === 1 ? shipped[0] : null;
  return { primary, others: shipped.filter((p) => p !== primary) };
}

/** The hero button's label: name the app the visitor would get. */
export function heroDownloadLabel(platform: Platform | 'unknown', downloads: Downloads | undefined): string {
  if (platform === 'windows') return downloads && !downloads.windows ? 'Download for Mac' : 'Download for Windows';
  if (platform === 'macos') return 'Download for Mac';
  return 'Download the app';
}

/** "26.0" → "macOS 26 or later"; "10.0.19041" → "Windows 10 or later" (build 22000 and up is Windows 11). */
export function minimumOsLabel(platform: DownloadPlatform, minimumOs: string): string {
  if (platform === 'windows') {
    const build = Number(minimumOs.split('.')[2] ?? 0);
    return `Windows ${build >= 22000 ? 11 : 10} or later`;
  }
  const v = minimumOs.replace(/^macOS\s*/i, '').replace(/(\.0)+$/, '');
  return `macOS ${v} or later`;
}
