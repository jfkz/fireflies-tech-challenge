import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/utils';
import { DownloadSection } from './DownloadSection';

const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';
const WIN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const LINUX_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

const mac = { platform: 'macos', version: '1.2.0', build: '57', url: 'https://download.boringtalks.lol/BoringTalks-1.2.0.dmg', sizeBytes: 15_000_000, minimumOs: '26.0', notarized: false, publishedAt: '2026-10-05T12:00:00.000Z' };
const windows = { platform: 'windows', version: '0.1.0', build: '61', url: 'https://download.boringtalks.lol/BoringTalks-Setup-0.1.0.exe', sizeBytes: 90_000_000, minimumOs: '10.0.19041', notarized: false, publishedAt: '2026-10-12T12:00:00.000Z' };

function serve(body: unknown, status = 200, userAgent = MAC_UA) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));
  renderWithProviders(<DownloadSection />);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('DownloadSection', () => {
  it('links a Mac straight to the DMG and adds the right-click step when not notarized', async () => {
    serve({ macos: mac, windows: null });
    expect(await screen.findByTestId('download-dmg')).toHaveAttribute('href', mac.url);
    expect(screen.getByRole('heading', { name: 'Put a notetaker on your Mac.' })).toBeInTheDocument();
    expect(screen.getByText('Version 1.2.0 (57)')).toBeInTheDocument();
    expect(screen.getByText('macOS 26 or later')).toBeInTheDocument();
    expect(screen.getByText('14.3 MB disk image')).toBeInTheDocument();
    expect(screen.getByText(/right-click the app and choose Open/)).toBeInTheDocument();
    expect(screen.queryByTestId('download-exe')).toBeNull();
  });

  it('puts the Windows app first on a PC, with SmartScreen help, and offers the Mac one underneath', async () => {
    serve({ macos: mac, windows }, 200, WIN_UA);
    const card = await screen.findByTestId('download-card-windows');
    expect(screen.getByRole('heading', { name: 'Put a notetaker on your PC.' })).toBeInTheDocument();
    expect(within(card).getByTestId('download-exe')).toHaveAttribute('href', windows.url);
    expect(within(card).getByText('Windows 10 or later')).toBeInTheDocument();
    expect(within(card).getByText('64-bit PCs (x64)')).toBeInTheDocument();
    expect(within(card).getByText('85.8 MB installer')).toBeInTheDocument();
    expect(screen.getByTestId('first-launch-windows')).toHaveTextContent(/More info.*Run anyway/);
    expect(screen.queryByTestId('first-launch-macos')).toBeNull();
    expect(screen.getByText('Also for Mac:')).toBeInTheDocument();
    expect(screen.getByTestId('download-dmg')).toHaveAttribute('href', mac.url);
  });

  it('leaves out the SmartScreen step for a signed Windows build', async () => {
    serve({ macos: null, windows: { ...windows, notarized: true } }, 200, WIN_UA);
    expect(await screen.findByTestId('first-launch-windows')).not.toHaveTextContent(/Run anyway/);
  });

  it('still offers the Mac app to a PC before the Windows app ships', async () => {
    serve({ macos: mac, windows: null }, 200, WIN_UA);
    expect(await screen.findByTestId('download-dmg')).toHaveAttribute('href', mac.url);
    expect(screen.getByTestId('first-launch-macos')).toBeInTheDocument();
  });

  it('shows both apps side by side when it can’t tell the computer', async () => {
    serve({ macos: mac, windows }, 200, LINUX_UA);
    expect(await screen.findByTestId('download-card-macos')).toBeInTheDocument();
    expect(screen.getByTestId('download-card-windows')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Put a notetaker on your computer.' })).toBeInTheDocument();
    expect(screen.queryByText('The first launch')).toBeNull();
  });

  it('says “coming soon” before the first build', async () => {
    serve({ macos: null, windows: null });
    expect(await screen.findByTestId('download-coming-soon')).toHaveTextContent('still in the oven');
    expect(screen.queryByText(/right-click/)).toBeNull();
  });

  it('says so when it can’t check', async () => {
    serve({ statusCode: 500, message: 'boom' }, 500);
    expect(await screen.findByTestId('download-coming-soon', {}, { timeout: 5000 })).toHaveTextContent('couldn’t check');
  });
});
