import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authValue, makeClient, Providers, renderWithProviders } from '@/test/utils';
import { Analytics } from './Analytics';

const tracker = vi.hoisted(() => ({ pageview: vi.fn(), track: vi.fn(), identify: vi.fn(), reset: vi.fn() }));
vi.mock('@/lib/analytics', () => ({ analytics: tracker }));

const nav = vi.hoisted(() => ({ pathname: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }));

const ME = { id: '00000000-0000-4000-8000-000000000009', email: 'me@example.com', name: null, emailOnReady: true, createdAt: '2026-10-01T10:00:00.000Z', isAdmin: true };

beforeEach(() => {
  vi.clearAllMocks();
  nav.pathname = '/';
});

describe('Analytics', () => {
  it('counts a page view on each route', () => {
    const { rerender } = renderWithProviders(<Analytics />);
    expect(tracker.pageview).toHaveBeenCalledTimes(1);
    rerender(<Analytics />);
    expect(tracker.pageview).toHaveBeenCalledTimes(1);
    nav.pathname = '/meetings';
    rerender(<Analytics />);
    expect(tracker.pageview).toHaveBeenCalledTimes(2);
  });

  it('identifies by account id once /me loads, and forgets them on sign-out', async () => {
    const client = makeClient();
    const tree = (signedOutByUser: boolean) => (
      <Providers client={client} auth={authValue({ signedOutByUser })}>
        <Analytics />
      </Providers>
    );
    const { rerender } = render(tree(false));
    act(() => client.setQueryData(['meetings'], []));
    act(() => client.setQueryData(['me', 'u1'], ME));
    act(() => client.setQueryData(['me', 'u1'], { ...ME }));
    await waitFor(() => expect(tracker.identify).toHaveBeenCalledWith(ME.id, { isAdmin: true, createdAt: ME.createdAt }));
    expect(tracker.identify).toHaveBeenCalledTimes(1);
    expect(tracker.reset).not.toHaveBeenCalled();

    rerender(tree(true));
    expect(tracker.reset).toHaveBeenCalledTimes(1);
  });

  it('has nobody to forget when nobody was identified', () => {
    renderWithProviders(<Analytics />, { auth: authValue({ signedOutByUser: true }) });
    expect(tracker.reset).not.toHaveBeenCalled();
  });
});
