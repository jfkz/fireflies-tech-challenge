import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/utils';
import { DownloadSection, minimumOsLabel } from './DownloadSection';

afterEach(() => vi.unstubAllGlobals());

const latest = { version: '1.2.0', build: '57', url: 'https://download.boringtalks.lol/BoringTalks-1.2.0.dmg', sizeBytes: 15_000_000, minimumOs: '26.0', notarized: false, publishedAt: '2026-10-05T12:00:00.000Z' };

describe('DownloadSection', () => {
  it('formats the minimum OS', () => {
    expect(minimumOsLabel('26.0')).toBe('macOS 26 or later');
    expect(minimumOsLabel('macOS 26.1')).toBe('macOS 26.1 or later');
  });

  it('links straight to the DMG and adds the right-click step when not notarized', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(latest), { status: 200 })));
    renderWithProviders(<DownloadSection />);
    expect(await screen.findByTestId('download-dmg')).toHaveAttribute('href', latest.url);
    expect(screen.getByText('Version 1.2.0 (57)')).toBeInTheDocument();
    expect(screen.getByText('macOS 26 or later')).toBeInTheDocument();
    expect(screen.getByText('14.3 MB disk image')).toBeInTheDocument();
    expect(screen.getByText(/right-click the app and choose Open/)).toBeInTheDocument();
  });

  it('says “coming soon” before the first build', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ statusCode: 404, message: 'none' }), { status: 404 })));
    renderWithProviders(<DownloadSection />);
    expect(await screen.findByTestId('download-coming-soon')).toHaveTextContent('still in the oven');
    expect(screen.queryByText(/right-click/)).toBeNull();
  });
});
