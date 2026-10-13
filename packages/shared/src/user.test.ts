import { describe, expect, it } from 'vitest';
import { Downloads, LatestDownload } from './user';

const mac = {
  version: '0.3.0',
  build: '406000',
  url: 'https://download.boringtalks.lol/BoringTalks-0.3.0.dmg',
  sizeBytes: 12_000_000,
  minimumOs: '26.0',
  notarized: true,
  publishedAt: '2026-10-01T10:00:00.000Z',
};

describe('LatestDownload', () => {
  it('reads manifests from before the Windows app as Mac builds', () => {
    expect(LatestDownload.parse(mac).platform).toBe('macos');
  });
  it('keeps the platform it is given', () => {
    expect(LatestDownload.parse({ ...mac, platform: 'windows' }).platform).toBe('windows');
    expect(LatestDownload.safeParse({ ...mac, platform: 'linux' }).success).toBe(false);
  });
});

describe('Downloads', () => {
  it('allows a platform with no build yet', () => {
    const parsed = Downloads.parse({ macos: mac, windows: null });
    expect(parsed.macos?.platform).toBe('macos');
    expect(parsed.windows).toBeNull();
  });
});
