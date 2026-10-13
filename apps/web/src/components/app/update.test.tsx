import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BUILD,
  fetchServices,
  holdUpdates,
  isNewBuild,
  parseBuildInfo,
  servicesLabel,
  setLiveBuild,
  updatesHeld,
  versionLabel,
  type BuildInfo,
} from '@/lib/version';
import { UpdatePrompt, VersionTag } from './UpdatePrompt';

const CURRENT: BuildInfo = { version: '0.2.0', commit: 'aaaaaaa' };
const NEWER: BuildInfo = { version: '0.2.1', commit: 'bbbbbbb' };

describe('version helpers', () => {
  it('labels a build', () => {
    expect(versionLabel(CURRENT)).toBe('v0.2.0 · aaaaaaa');
    expect(versionLabel({ version: '0.2.0', commit: 'dev' })).toBe('v0.2.0 · dev');
    expect(BUILD.commit).toBe('dev');
  });

  it('tells a different deployment apart, but never for local builds', () => {
    expect(isNewBuild(NEWER, CURRENT)).toBe(true);
    expect(isNewBuild(CURRENT, CURRENT)).toBe(false);
    expect(isNewBuild(NEWER, { version: '0.2.0', commit: 'dev' })).toBe(false);
    expect(isNewBuild({ version: '0.2.0', commit: 'dev' }, CURRENT)).toBe(false);
  });

  it('reads only well-formed answers', () => {
    expect(parseBuildInfo(NEWER)).toEqual(NEWER);
    expect(parseBuildInfo({ version: '1', commit: '' })).toBeNull();
    expect(parseBuildInfo({ version: 1, commit: 'x' })).toBeNull();
    expect(parseBuildInfo('nope')).toBeNull();
    expect(parseBuildInfo(null)).toBeNull();
  });

  it('counts holds and releases each once', () => {
    const a = holdUpdates();
    const b = holdUpdates();
    expect(updatesHeld()).toBe(true);
    a();
    a();
    expect(updatesHeld()).toBe(true);
    b();
    expect(updatesHeld()).toBe(false);
  });
});

describe('UpdatePrompt', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify(NEWER), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    act(() => setLiveBuild(null));
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

  it('asks to reload once a newer deployment is live', async () => {
    const reload = vi.fn();
    render(
      <>
        <UpdatePrompt current={CURRENT} intervalMs={1000} reload={reload} />
        <VersionTag current={CURRENT} reload={reload} />
      </>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('v0.2.0 · aaaaaaa')).toBeInTheDocument();

    await tick(1000);
    expect(fetchMock).toHaveBeenCalledWith('/version.json', { cache: 'no-store' });
    const dialog = screen.getByRole('dialog', { name: 'A new version is out' });
    expect(dialog).toHaveTextContent('v0.2.1 · bbbbbbb');
    fireEvent.click(screen.getByRole('button', { name: 'Reload now' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('"Later" leaves a reload link in the footer instead', async () => {
    const reload = vi.fn();
    render(
      <>
        <UpdatePrompt current={CURRENT} intervalMs={1000} reload={reload} />
        <VersionTag current={CURRENT} reload={reload} />
      </>,
    );
    await tick(1000);
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.getByRole('dialog', { hidden: true })).not.toHaveAttribute('open');
    await tick(1000);
    expect(screen.getByRole('dialog', { hidden: true })).not.toHaveAttribute('open');
    fireEvent.click(screen.getByRole('button', { name: 'New version: reload' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('waits while a recording would be lost', async () => {
    const release = holdUpdates();
    render(<UpdatePrompt current={CURRENT} intervalMs={1000} />);
    await tick(1000);
    expect(screen.getByRole('dialog', { hidden: true })).not.toHaveAttribute('open');
    act(() => release());
    expect(screen.getByRole('dialog')).toHaveAttribute('open');
  });

  it('stays quiet for the same build, errors and local builds', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(CURRENT)));
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 503 }));
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    render(<UpdatePrompt current={CURRENT} intervalMs={1000} />);
    await tick(3000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.getByRole('dialog', { hidden: true })).not.toHaveAttribute('open');
  });

  it('does not poll a local build', async () => {
    render(<UpdatePrompt current={{ version: '0.2.0', commit: 'dev' }} intervalMs={1000} />);
    await tick(5000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('checks when the tab comes back, at most once a minute, and not while hidden', async () => {
    let visibility: DocumentVisibilityState = 'hidden';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    render(<UpdatePrompt current={CURRENT} intervalMs={10 * 60_000} />);
    await tick(61_000);
    visibility = 'visible';
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog')).toHaveAttribute('open');
  });
});

describe('the API and Mac versions', () => {
  const API: BuildInfo = { version: '0.2.3', commit: 'ccccccccccccccc' };
  const MAC: BuildInfo = { version: '0.2.0', commit: '4242' };

  it('label only the parts that answered', () => {
    expect(servicesLabel({ api: API, mac: MAC })).toBe('API v0.2.3 · Mac v0.2.0');
    expect(servicesLabel({ api: API })).toBe('API v0.2.3');
    expect(servicesLabel({})).toBe('');
  });

  it('come from /health and /downloads/latest', async () => {
    const answers: Record<string, Response | Error> = {
      'https://api.test/health': new Response(JSON.stringify({ status: 'error', version: '0.2.3', commit: API.commit }), { status: 503 }),
      'https://api.test/downloads/latest': new Response(JSON.stringify({ version: '0.2.0', build: '4242', url: 'https://x' })),
    };
    const doFetch = vi.fn((url: string) => {
      const answer = answers[url];
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    }) as unknown as typeof fetch;
    await expect(fetchServices('https://api.test', doFetch)).resolves.toEqual({ api: API, mac: MAC });

    answers['https://api.test/health'] = new Error('offline');
    answers['https://api.test/downloads/latest'] = new Response('{}', { status: 404 });
    await expect(fetchServices('https://api.test', doFetch)).resolves.toEqual({ api: undefined, mac: undefined });
  });

  it('follow the web version in the dashboard footer', async () => {
    render(<VersionTag current={CURRENT} services loadOthers={() => Promise.resolve({ api: API, mac: MAC })} />);
    const label = await screen.findByText('API v0.2.3 · Mac v0.2.0');
    expect(label).toHaveAttribute('title', 'API 0.2.3, commit ccccccc; Mac app 0.2.0 (build 4242)');
    expect(screen.getByText('v0.2.0 · aaaaaaa')).toBeInTheDocument();
  });

  it('are not asked for elsewhere', () => {
    const loadOthers = vi.fn(() => Promise.resolve({}));
    render(<VersionTag current={CURRENT} loadOthers={loadOthers} />);
    expect(loadOthers).not.toHaveBeenCalled();
  });
});
