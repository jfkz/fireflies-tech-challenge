import type { ProblemReportDetail, ProblemReportSummary } from '@boringtalks/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { authValue, fakeApi, renderWithProviders } from '@/test/utils';
import { AppShell } from './AppShell';
import { ReportsView, ReportView } from './ReportsView';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/admin/reports',
  useSearchParams: () => new URLSearchParams(),
}));

const ME = { id: '00000000-0000-4000-8000-000000000009', email: 'boss@example.com', name: null, emailOnReady: true, createdAt: '2026-10-01T10:00:00.000Z', isAdmin: true };

const summary = (id: string, over: Partial<ProblemReportSummary> = {}): ProblemReportSummary => ({
  id,
  kind: 'hang',
  message: '',
  user: { id: '00000000-0000-4000-8000-000000000001', email: 'ann@example.com' },
  deviceId: null,
  app: { version: '0.5.0', build: '12', flavor: 'release' },
  system: { os: 'Windows 11 Pro 10.0.22631', model: '' },
  logBytes: 2048,
  createdAt: '2026-10-08T18:00:00.000Z',
  ...over,
});

const R1 = '33333333-3333-4333-8333-333333333331';
const R2 = '33333333-3333-4333-8333-333333333332';

describe('AppShell', () => {
  it('shows Admin to admins only', async () => {
    const { unmount } = renderWithProviders(<AppShell>body</AppShell>, { auth: authValue({ api: fakeApi({ me: vi.fn(async () => ME) }) }) });
    expect((await screen.findAllByRole('link', { name: 'Admin' }))[0]).toHaveAttribute('href', '/admin');
    unmount();
    const me = vi.fn(async () => ({ ...ME, isAdmin: false }));
    renderWithProviders(<AppShell>body</AppShell>, { auth: authValue({ api: fakeApi({ me }) }) });
    await waitFor(() => expect(me).toHaveBeenCalled());
    expect(screen.queryByRole('link', { name: 'Admin' })).toBeNull();
  });
});

describe('ReportsView', () => {
  it('lists every report, narrows by kind and user, and pages on', async () => {
    const listReports = vi.fn(async (q: { cursor?: string }) =>
      q.cursor
        ? { items: [summary(R2, { kind: 'user', message: 'Old one' })], nextCursor: null }
        : { items: [summary(R1, { message: 'It froze\nafter Zoom', app: { version: '0.5.0', build: '', flavor: 'dev' } })], nextCursor: 'next' },
    );
    renderWithProviders(<ReportsView />, { auth: authValue({ api: fakeApi({ me: vi.fn(async () => ME), listReports: listReports as never }) }) });

    const list = await screen.findByRole('list', { name: 'Reports' });
    const row = within(list).getByRole('link', { name: /It froze/ });
    expect(row).toHaveAttribute('href', `/admin/reports/${R1}`);
    expect(row).toHaveTextContent('ann@example.com');
    expect(row).toHaveTextContent('0.5.0 dev · Windows 11 Pro');
    expect(row).not.toHaveTextContent('after Zoom');

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Old one')).toBeInTheDocument();
    expect(listReports).toHaveBeenLastCalledWith({ cursor: 'next', limit: 50 }, expect.anything());

    fireEvent.click(within(screen.getByRole('group', { name: 'Kind' })).getByRole('button', { name: 'Hangs' }));
    await waitFor(() => expect(listReports).toHaveBeenLastCalledWith({ kind: 'hang', limit: 50 }, expect.anything()));
    fireEvent.change(screen.getByRole('searchbox', { name: 'User email or id' }), { target: { value: ' ann@example.com ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
    await waitFor(() => expect(listReports).toHaveBeenLastCalledWith({ kind: 'hang', user: 'ann@example.com', limit: 50 }, expect.anything()));
  });

  it('says when nothing matches, and tells everyone else it is for admins', async () => {
    const listReports = vi.fn(async () => ({ items: [], nextCursor: null }));
    const { unmount } = renderWithProviders(<ReportsView />, { auth: authValue({ api: fakeApi({ me: vi.fn(async () => ME), listReports }) }) });
    expect(await screen.findByText(/No reports yet/)).toBeInTheDocument();
    unmount();

    const notAdmin = vi.fn();
    renderWithProviders(<ReportsView />, { auth: authValue({ api: fakeApi({ me: vi.fn(async () => ({ ...ME, isAdmin: false })), listReports: notAdmin }) }) });
    expect(await screen.findByText('Only admins can see problem reports.')).toBeInTheDocument();
    expect(notAdmin).not.toHaveBeenCalled();
  });

  it('shows what the API says went wrong', async () => {
    const listReports = vi.fn(async () => Promise.reject(new Error('Only an admin can see this')));
    renderWithProviders(<ReportsView />, { auth: authValue({ api: fakeApi({ me: vi.fn(async () => ME), listReports }) }) });
    expect(await screen.findByRole('alert')).toHaveTextContent('Only an admin can see this');
  });
});

describe('ReportView', () => {
  const detail: ProblemReportDetail = {
    ...summary(R1, { message: 'Pressed Yes, record and it froze', deviceId: '44444444-4444-4444-8444-444444444444' }),
    diagnostics: { 'recorder.phase': 'starting', 'mic.device': 'Headset' },
    log: '12:00:01 call detected: zoom\n12:00:03 start recording',
  };

  it('shows who sent it, the diagnostics and the log, which copies', async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    const getReport = vi.fn(async () => detail);
    renderWithProviders(<ReportView id={R1} />, { auth: authValue({ api: fakeApi({ me: vi.fn(async () => ME), getReport }) }) });

    expect(await screen.findByRole('heading', { name: /Hang/ })).toBeInTheDocument();
    expect(getReport).toHaveBeenCalledWith(R1, expect.anything());
    expect(screen.getByText('Pressed Yes, record and it froze')).toBeInTheDocument();
    expect(screen.getByText(/device 44444444/)).toBeInTheDocument();
    expect(screen.getByText(/BoringTalks 0\.5\.0/)).toHaveTextContent('(build 12)');
    const diagnostics = screen.getByRole('region', { name: 'Diagnostics' });
    expect(within(diagnostics).getByText('recorder.phase').nextSibling).toHaveTextContent('starting');
    const log = screen.getByRole('region', { name: 'Log' });
    expect(log).toHaveTextContent('Log · 2.0 KB');
    expect(log).toHaveTextContent('call detected: zoom');
    fireEvent.click(within(log).getByRole('button', { name: 'Copy log' }));
    await waitFor(() => expect(within(log).getByRole('button', { name: 'Copied' })).toBeInTheDocument());
    expect(writeText).toHaveBeenCalledWith(detail.log);
  });

  it('says what is missing, and when the report is not there', async () => {
    const getReport = vi.fn(async () => ({ ...detail, kind: 'user' as const, message: '', diagnostics: {}, log: '', logBytes: 0, app: { ...detail.app, build: '' } }));
    const { unmount } = renderWithProviders(<ReportView id={R1} />, { auth: authValue({ api: fakeApi({ me: vi.fn(async () => ME), getReport }) }) });
    expect(await screen.findByRole('heading', { name: /Problem report/ })).toBeInTheDocument();
    expect(screen.getByText('No message')).toBeInTheDocument();
    expect(screen.getByText('None')).toBeInTheDocument();
    expect(screen.getByText('Not included')).toBeInTheDocument();
    unmount();

    const missing = vi.fn(async () => Promise.reject(new Error('Report not found')));
    const { unmount: gone } = renderWithProviders(<ReportView id={R2} />, { auth: authValue({ api: fakeApi({ me: vi.fn(async () => ME), getReport: missing }) }) });
    expect(await screen.findByRole('alert')).toHaveTextContent('Report not found');
    gone();

    renderWithProviders(<ReportView id={R2} />, { auth: authValue({ api: fakeApi({ me: vi.fn(async () => ({ ...ME, isAdmin: false })) }) }) });
    expect(await screen.findByText('Only admins can see problem reports.')).toBeInTheDocument();
  });
});
