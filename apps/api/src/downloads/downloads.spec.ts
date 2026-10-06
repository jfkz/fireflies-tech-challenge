import { NotFoundException } from '@nestjs/common';
import { testConfig } from '../testing/fixtures';
import { DownloadsController } from './downloads.controller';
import { DOWNLOADS_CACHE_MS, DOWNLOADS_MISS_CACHE_MS, DownloadsService } from './downloads.service';

const latest = {
  version: '1.2.0',
  build: '42',
  url: 'https://download.boringtalks.lol/BoringTalks-1.2.0.dmg',
  sizeBytes: 12_000_000,
  minimumOs: '26.0',
  notarized: true,
  publishedAt: '2026-10-06T10:00:00Z',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('DownloadsService', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reads latest.json and caches it for five minutes', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(latest));
    const s = new DownloadsService(testConfig({ DOWNLOADS_BASE_URL: 'https://dl.test/' }));
    await expect(s.latest(0)).resolves.toEqual(latest);
    await expect(s.latest(DOWNLOADS_CACHE_MS - 1)).resolves.toEqual(latest);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toBe('https://dl.test/latest.json');
    fetch.mockResolvedValue(json({ ...latest, version: '1.3.0' }));
    await expect(s.latest(DOWNLOADS_CACHE_MS + 1)).resolves.toMatchObject({ version: '1.3.0' });
  });

  it.each([
    ['missing', () => Promise.resolve(json({}, 404))],
    ['malformed', () => Promise.resolve(json({ version: 1 }))],
    ['unreachable', () => Promise.reject(new Error('ENOTFOUND'))],
  ])('answers 404 when latest.json is %s', async (_, impl) => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(impl);
    const s = new DownloadsService(testConfig());
    await expect(s.latest(0)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('retries a missing latest.json after 30 seconds, not five minutes', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({}, 404));
    const s = new DownloadsService(testConfig());
    await expect(s.latest(0)).rejects.toBeInstanceOf(NotFoundException);
    await expect(s.latest(DOWNLOADS_MISS_CACHE_MS - 1)).rejects.toBeInstanceOf(NotFoundException);
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockResolvedValue(json(latest));
    await expect(s.latest(DOWNLOADS_MISS_CACHE_MS + 1)).resolves.toEqual(latest);
  });

  it('is exposed by the controller', async () => {
    const service = { latest: vi.fn().mockResolvedValue(latest) };
    await expect(new DownloadsController(service as never).latest()).resolves.toEqual(latest);
  });
});
