import { NotFoundException } from '@nestjs/common';
import { testConfig } from '../testing/fixtures';
import { DownloadsController } from './downloads.controller';
import { DOWNLOADS_CACHE_MS, DOWNLOADS_MISS_CACHE_MS, DownloadsService } from './downloads.service';

/** A manifest published before the Windows app, with no `platform`. */
const mac = {
  version: '1.2.0',
  build: '42',
  url: 'https://download.boringtalks.lol/BoringTalks-1.2.0.dmg',
  sizeBytes: 12_000_000,
  minimumOs: '26.0',
  notarized: true,
  publishedAt: '2026-10-06T10:00:00Z',
};
const latest = { ...mac, platform: 'macos' };
const windows = {
  ...mac,
  platform: 'windows',
  url: 'https://download.boringtalks.lol/BoringTalks-Setup-0.1.0.exe',
  version: '0.1.0',
  minimumOs: '10.0.19041',
  notarized: false,
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const fileOf = (input: unknown) => String(input).split('/').pop()!;

/** Serves each manifest by file name; anything else is a 404. */
function serve(files: Record<string, unknown>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const name = fileOf(input);
    return Promise.resolve(name in files ? json(files[name]) : json({}, 404));
  });
}

describe('DownloadsService', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reads latest.json and caches it for five minutes', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(mac));
    const s = new DownloadsService(testConfig({ DOWNLOADS_BASE_URL: 'https://dl.test/' }));
    await expect(s.latest('macos', 0)).resolves.toEqual(latest);
    await expect(s.latest('macos', DOWNLOADS_CACHE_MS - 1)).resolves.toEqual(latest);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toBe('https://dl.test/latest.json');
    fetch.mockResolvedValue(json({ ...mac, version: '1.3.0' }));
    await expect(s.latest('macos', DOWNLOADS_CACHE_MS + 1)).resolves.toMatchObject({ version: '1.3.0' });
  });

  it('reads the Windows build from latest-windows.json', async () => {
    const fetch = serve({ 'latest-windows.json': windows });
    const s = new DownloadsService(testConfig({ DOWNLOADS_BASE_URL: 'https://dl.test' }));
    await expect(s.latest('windows', 0)).resolves.toEqual(windows);
    expect(String(fetch.mock.calls[0][0])).toBe('https://dl.test/latest-windows.json');
  });

  it.each([
    ['missing', () => Promise.resolve(json({}, 404))],
    ['malformed', () => Promise.resolve(json({ version: 1 }))],
    ['unreachable', () => Promise.reject(new Error('ENOTFOUND'))],
  ])('answers 404 when latest.json is %s', async (_, impl) => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(impl);
    const s = new DownloadsService(testConfig());
    await expect(s.latest('macos', 0)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('answers 404 for a platform it does not build for', async () => {
    const fetch = serve({});
    await expect(new DownloadsService(testConfig()).latest('linux', 0)).rejects.toBeInstanceOf(NotFoundException);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('ignores a manifest that describes another platform', async () => {
    serve({ 'latest-windows.json': latest });
    await expect(new DownloadsService(testConfig()).latest('windows', 0)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('retries a missing manifest after 30 seconds, not five minutes', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({}, 404));
    const s = new DownloadsService(testConfig());
    await expect(s.latest('macos', 0)).rejects.toBeInstanceOf(NotFoundException);
    await expect(s.latest('macos', DOWNLOADS_MISS_CACHE_MS - 1)).rejects.toBeInstanceOf(NotFoundException);
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockResolvedValue(json(mac));
    await expect(s.latest('macos', DOWNLOADS_MISS_CACHE_MS + 1)).resolves.toEqual(latest);
  });

  it('caches each platform on its own', async () => {
    const fetch = serve({ 'latest.json': mac });
    const s = new DownloadsService(testConfig());
    await expect(s.all(0)).resolves.toEqual({ macos: latest, windows: null });
    expect(fetch).toHaveBeenCalledTimes(2);
    // The Mac build is still fresh; the missing Windows one is asked for again.
    fetch.mockClear();
    await s.all(DOWNLOADS_MISS_CACHE_MS + 1);
    expect(fetch.mock.calls.map((c) => fileOf(c[0]))).toEqual(['latest-windows.json']);
  });

  it('shares one request between callers waiting on the same manifest', async () => {
    const fetch = serve({ 'latest.json': mac, 'latest-windows.json': windows });
    const s = new DownloadsService(testConfig());
    const [both, one] = await Promise.all([s.all(0), s.latest('windows', 0)]);
    expect(both).toEqual({ macos: latest, windows });
    expect(one).toEqual(windows);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('is exposed by the controller', async () => {
    const service = { latest: vi.fn().mockResolvedValue(latest), all: vi.fn().mockResolvedValue({ macos: latest, windows: null }) };
    const c = new DownloadsController(service as never);
    await expect(c.latest()).resolves.toEqual(latest);
    expect(service.latest).toHaveBeenLastCalledWith('macos');
    await c.latestFor('windows');
    expect(service.latest).toHaveBeenLastCalledWith('windows');
    await expect(c.all()).resolves.toEqual({ macos: latest, windows: null });
  });
});
