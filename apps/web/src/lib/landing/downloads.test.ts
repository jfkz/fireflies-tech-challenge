import type { Downloads, LatestDownload } from '@boringtalks/shared';
import { describe, expect, it } from 'vitest';
import { chooseDownloads, heroDownloadLabel, minimumOsLabel } from './downloads';

const build = { version: '1', build: '1', url: 'https://d.test/x', sizeBytes: 1, minimumOs: '26.0', notarized: true, publishedAt: '2026-10-01T10:00:00.000Z' };
const mac: LatestDownload = { ...build, platform: 'macos' };
const win: LatestDownload = { ...build, platform: 'windows', minimumOs: '10.0.19041' };
const both: Downloads = { macos: mac, windows: win };

describe('chooseDownloads', () => {
  it('puts the visitor’s own app first and the other one under it', () => {
    expect(chooseDownloads('windows', both)).toEqual({ primary: 'windows', others: ['macos'] });
    expect(chooseDownloads('macos', both)).toEqual({ primary: 'macos', others: ['windows'] });
  });

  it('falls back to whatever has shipped', () => {
    expect(chooseDownloads('windows', { macos: mac, windows: null })).toEqual({ primary: 'macos', others: [] });
    expect(chooseDownloads('macos', { macos: null, windows: win })).toEqual({ primary: 'windows', others: [] });
    expect(chooseDownloads('other', { macos: mac, windows: null })).toEqual({ primary: 'macos', others: [] });
  });

  it('shows both side by side when the computer is unknown', () => {
    expect(chooseDownloads('other', both)).toEqual({ primary: null, others: ['macos', 'windows'] });
    expect(chooseDownloads('unknown', both)).toEqual({ primary: null, others: ['macos', 'windows'] });
  });

  it('offers nothing before the first build', () => {
    expect(chooseDownloads('macos', { macos: null, windows: null })).toEqual({ primary: null, others: [] });
  });
});

describe('heroDownloadLabel', () => {
  it('names the app the visitor would get', () => {
    expect(heroDownloadLabel('windows', both)).toBe('Download for Windows');
    expect(heroDownloadLabel('windows', undefined)).toBe('Download for Windows');
    expect(heroDownloadLabel('windows', { macos: mac, windows: null })).toBe('Download for Mac');
    expect(heroDownloadLabel('macos', both)).toBe('Download for Mac');
    expect(heroDownloadLabel('other', both)).toBe('Download the app');
    expect(heroDownloadLabel('unknown', undefined)).toBe('Download the app');
  });
});

describe('minimumOsLabel', () => {
  it('formats macOS versions', () => {
    expect(minimumOsLabel('macos', '26.0')).toBe('macOS 26 or later');
    expect(minimumOsLabel('macos', 'macOS 26.1')).toBe('macOS 26.1 or later');
  });

  it('names the Windows release from the build number', () => {
    expect(minimumOsLabel('windows', '10.0.19041')).toBe('Windows 10 or later');
    expect(minimumOsLabel('windows', '10.0.22631')).toBe('Windows 11 or later');
    expect(minimumOsLabel('windows', '10')).toBe('Windows 10 or later');
  });
});
