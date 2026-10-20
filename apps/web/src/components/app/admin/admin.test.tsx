import type { AdminDay, AdminList, AdminOverview, AdminSettings, AdminUserDetail, AdminUserSummary } from '@boringtalks/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authValue, fakeApi, renderWithProviders } from '@/test/utils';
import { AdminFrame } from './AdminFrame';
import { AdminOverviewView, DailyChart } from './AdminOverviewView';
import { AdminSettingsView } from './AdminSettingsView';
import { AdminUsersView } from './AdminUsersView';
import { AdminUserView } from './AdminUserView';

const nav = vi.hoisted(() => ({ pathname: '/admin' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(),
}));

const ME = { id: '00000000-0000-4000-8000-000000000009', email: 'boss@example.com', name: 'Boss', emailOnReady: true, createdAt: '2026-10-01T10:00:00.000Z', isAdmin: true, isOwner: true };
const ANN = '00000000-0000-4000-8000-000000000001';

const day = (date: string, meetings = 0, hours = 0, signups = 0): AdminDay => ({ date, meetings, hours, signups });

const OVERVIEW: AdminOverview = {
  days: 30,
  tz: 'UTC',
  users: { total: 1284, new7d: 4, newInWindow: 12, active1d: 3, active7d: 40, active30d: 90, admins: 2 },
  meetings: {
    total: 500,
    totalHours: 420.5,
    inWindow: 120,
    hoursInWindow: 80.2,
    bySource: { macos: 50, windows: 40, browser: 20, upload: 10, demo: 0 },
    byStatus: { recording: 1, uploaded: 0, transcribing: 2, summarizing: 0, ready: 110, failed: 7 },
    failureRate: 0.06,
  },
  devices: { active30d: 33, versions: [{ platform: 'windows', version: '0.6.0', count: 20 }, { platform: 'macos', version: null, count: 2 }] },
  reports: { last7d: 3, hangs7d: 1 },
  costs: { summaryInputTokens: 2_000_000, summaryOutputTokens: 150_000, summaryUsd: 2.75, serverTranscribedHours: 12.5, transcriptionUsd: 1.25, storageGb: 3.2, storageUsdPerMonth: 0.05 },
  daily: [day('2026-10-18', 2, 1.5, 1), day('2026-10-19', 0, 0, 0), day('2026-10-20', 5, 3, 2)],
};

const summary = (over: Partial<AdminUserSummary> = {}): AdminUserSummary => ({
  id: ANN,
  email: 'ann@example.com',
  name: 'Ann Lee',
  createdAt: '2026-10-01T10:00:00.000Z',
  lastActiveAt: '2026-10-20T10:00:00.000Z',
  meetingCount: 4,
  recordedMinutes: 130,
  lastMeetingAt: '2026-10-19T10:00:00.000Z',
  apps: [{ platform: 'windows', version: '0.6.0' }],
  isAdmin: false,
  isOwner: false,
  recordingLimitMinutes: null,
  ...over,
});

const detail = (over: Partial<AdminUserDetail> = {}): AdminUserDetail => ({
  ...summary(),
  effectiveRecordingLimitMinutes: 120,
  adminGrantedBy: null,
  last30d: { meetings: 3, recordedMinutes: 120, failed: 1 },
  devices: [
    { id: '00000000-0000-4000-8000-0000000000d1', name: 'Gaming PC', platform: 'windows', appVersion: '0.6.0', createdAt: '2026-10-01T10:00:00.000Z', lastSeenAt: '2026-10-20T10:00:00.000Z', revokedAt: null },
  ],
  meetings: [
    { id: '00000000-0000-4000-8000-0000000000e1', startedAt: '2026-10-19T10:00:00.000Z', source: 'windows', status: 'failed', durationSec: 3600, audioBytes: 43_000_000, error: 'Transcription failed' },
  ],
  reports: [],
  ...over,
});

beforeEach(() => {
  nav.pathname = '/admin';
});

describe('AdminFrame', () => {
  it('shows the admin tabs to admins and nothing else to anyone else', async () => {
    nav.pathname = '/admin/users';
    const { unmount } = renderWithProviders(<AdminFrame>inside</AdminFrame>, { auth: authValue({ api: fakeApi({ me: vi.fn(async () => ME) }) }) });
    expect(await screen.findByText('inside')).toBeInTheDocument();
    const tabs = screen.getByRole('navigation', { name: 'Admin' });
    expect(within(tabs).getByRole('link', { name: 'Users' })).toHaveAttribute('aria-current', 'page');
    expect(within(tabs).getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current');
    unmount();

    renderWithProviders(<AdminFrame>inside</AdminFrame>, { auth: authValue({ api: fakeApi({ me: vi.fn(async () => ({ ...ME, isAdmin: false })) }) }) });
    expect(await screen.findByText('Only admins can see this.')).toBeInTheDocument();
    expect(screen.queryByText('inside')).toBeNull();
  });
});

describe('AdminOverviewView', () => {
  it('shows the numbers, the breakdowns and the costs, and changes the period', async () => {
    const adminOverview = vi.fn(async () => OVERVIEW);
    renderWithProviders(<AdminOverviewView />, { auth: authValue({ api: fakeApi({ me: vi.fn(async () => ME), adminOverview }) }) });
    expect(await screen.findByText('1,284')).toBeInTheDocument();
    expect(screen.getByText('+12 in 30 days')).toBeInTheDocument();
    expect(screen.getByText('6%')).toBeInTheDocument();
    expect(screen.getByText('$4.00')).toBeInTheDocument();
    const sources = screen.getByRole('region', { name: 'Where meetings come from' });
    expect(within(sources).getByText('Mac app').nextSibling).toHaveTextContent('50');
    expect(within(sources).queryByText('Demo')).toBeNull();
    expect(screen.getByRole('region', { name: 'Desktop apps connected' })).toHaveTextContent('Mac (version not seen yet)');
    expect(screen.getByRole('link', { name: 'Read them' })).toHaveAttribute('href', '/admin/reports');
    expect(adminOverview).toHaveBeenCalledWith(expect.objectContaining({ days: 30 }), expect.anything());

    fireEvent.click(within(screen.getByRole('group', { name: 'Period' })).getByRole('button', { name: '90 days' }));
    await waitFor(() => expect(adminOverview).toHaveBeenLastCalledWith(expect.objectContaining({ days: 90 }), expect.anything()));
  });

  it('says what went wrong', async () => {
    renderWithProviders(<AdminOverviewView />, { auth: authValue({ api: fakeApi({ me: vi.fn(async () => ME), adminOverview: vi.fn(async () => Promise.reject(new Error('Only an admin can see this'))) }) }) });
    expect(await screen.findByRole('alert')).toHaveTextContent('Only an admin can see this');
  });
});

describe('DailyChart', () => {
  it('plots one measure, shows a day on hover and focus, and has the numbers as a table', () => {
    renderWithProviders(<DailyChart days={OVERVIEW.daily} />);
    expect(screen.getByRole('heading', { name: /Meetings per day · 7 in all/ })).toBeInTheDocument();
    const bars = within(screen.getByRole('list', { name: 'Meetings per day' })).getAllByRole('listitem');
    expect(bars).toHaveLength(3);
    expect(bars[2]).toHaveAccessibleName(/5 meetings/);
    fireEvent.pointerEnter(bars[2]);
    expect(screen.getByRole('tooltip')).toHaveTextContent('5 meetings');
    fireEvent.pointerLeave(screen.getByRole('list', { name: 'Meetings per day' }));
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Hours recorded' }));
    fireEvent.focus(within(screen.getByRole('list', { name: 'Hours recorded per day' })).getAllByRole('listitem')[0]);
    expect(screen.getByRole('tooltip')).toHaveTextContent('1.5 hours');
    expect(screen.getAllByRole('row')).toHaveLength(4);
  });
});

describe('AdminUsersView', () => {
  it('lists users with their usage, searches and pages on', async () => {
    const adminUsers = vi.fn(async (q: { q?: string; cursor?: string }) =>
      q.cursor
        ? { items: [summary({ id: '00000000-0000-4000-8000-000000000002', email: 'boss@example.com', isOwner: true, isAdmin: true })], nextCursor: null }
        : { items: [summary({ recordingLimitMinutes: 30 })], nextCursor: 'next' },
    );
    renderWithProviders(<AdminUsersView />, { auth: authValue({ api: fakeApi({ me: vi.fn(async () => ME), adminUsers: adminUsers as never }) }) });
    const row = await screen.findByRole('link', { name: /ann@example.com/ });
    expect(row).toHaveAttribute('href', `/admin/users/${ANN}`);
    expect(row).toHaveTextContent('4 meetings, 2 h 10 min');
    expect(row).toHaveTextContent('Windows 0.6.0');
    expect(row).toHaveTextContent('limit: 30 min');
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('owner')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Email, name or user id' }), { target: { value: ' lee ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(adminUsers).toHaveBeenLastCalledWith({ q: 'lee', cursor: undefined, limit: 50 }, expect.anything()));
  });

  it('says when nobody matches', async () => {
    renderWithProviders(<AdminUsersView />, { auth: authValue({ api: fakeApi({ me: vi.fn(async () => ME), adminUsers: vi.fn(async () => ({ items: [], nextCursor: null })) }) }) });
    expect(await screen.findByText('No users yet.')).toBeInTheDocument();
  });
});

describe('AdminUserView', () => {
  it('shows usage, computers and meetings without titles, and makes them an admin', async () => {
    // Behaves like the API: the change sticks for the refetch that follows.
    let current = detail();
    const updateAdminUser = vi.fn(async (_id: string, body: { isAdmin?: boolean }) => {
      current = detail({ isAdmin: body.isAdmin ?? false, adminGrantedBy: { id: ME.id, email: ME.email } });
      return current;
    });
    renderWithProviders(<AdminUserView id={ANN} />, {
      auth: authValue({ api: fakeApi({ me: vi.fn(async () => ME), adminUser: vi.fn(async () => current), updateAdminUser: updateAdminUser as never }) }),
    });
    expect(await screen.findByRole('heading', { name: /ann@example.com/ })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Computers' })).toHaveTextContent('Gaming PC');
    const meetings = screen.getByRole('region', { name: 'Meetings' });
    expect(meetings).toHaveTextContent('Windows app');
    expect(within(meetings).getByText('Failed')).toHaveAttribute('title', 'Transcription failed');
    expect(meetings).toHaveTextContent('1 h');

    fireEvent.click(screen.getByRole('button', { name: 'Make admin' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Make admin' }));
    await waitFor(() => expect(updateAdminUser).toHaveBeenCalledWith(ANN, { isAdmin: true }));
    expect(await screen.findByText(/made one by boss@example.com/)).toBeInTheDocument();
  });

  it('sets their own recording limit, or none, or back to the default', async () => {
    const updateAdminUser = vi.fn(async () => detail());
    renderWithProviders(<AdminUserView id={ANN} />, {
      auth: authValue({ api: fakeApi({ me: vi.fn(async () => ME), adminUser: vi.fn(async () => detail()), updateAdminUser }) }),
    });
    const form = await screen.findByRole('form', { name: 'Recording limit' });
    expect(form).toHaveTextContent('Now: Default (2 h)');
    fireEvent.change(within(form).getByRole('spinbutton', { name: 'Minutes' }), { target: { value: '45' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save limit' }));
    await waitFor(() => expect(updateAdminUser).toHaveBeenLastCalledWith(ANN, { recordingLimitMinutes: 45 }));
    fireEvent.click(within(form).getByRole('radio', { name: /No limit/ }));
    fireEvent.click(within(form).getByRole('button', { name: /Save|Saved/ }));
    await waitFor(() => expect(updateAdminUser).toHaveBeenLastCalledWith(ANN, { recordingLimitMinutes: 0 }));
    fireEvent.change(within(form).getByRole('spinbutton', { name: 'Minutes' }), { target: { value: '0' } });
    expect(within(form).getByText(/Between 1 and/)).toBeInTheDocument();
  });

  it('never offers to remove an owner, or yourself', async () => {
    const { unmount } = renderWithProviders(<AdminUserView id={ANN} />, {
      auth: authValue({ api: fakeApi({ me: vi.fn(async () => ME), adminUser: vi.fn(async () => detail({ isOwner: true, isAdmin: true })) }) }),
    });
    expect(await screen.findByText(/Owners are always admins/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove admin rights' })).toBeNull();
    unmount();
    renderWithProviders(<AdminUserView id={ME.id} />, {
      auth: authValue({ api: fakeApi({ me: vi.fn(async () => ({ ...ME, isOwner: false })), adminUser: vi.fn(async () => detail({ id: ME.id, isAdmin: true })) }) }),
    });
    expect(await screen.findByText('You can’t remove your own admin rights.')).toBeInTheDocument();
  });

  it('says when the user is not there', async () => {
    renderWithProviders(<AdminUserView id={ANN} />, { auth: authValue({ api: fakeApi({ me: vi.fn(async () => ME), adminUser: vi.fn(async () => Promise.reject(new Error('User not found'))) }) }) });
    expect(await screen.findByRole('alert')).toHaveTextContent('User not found');
  });
});

describe('AdminSettingsView', () => {
  const SETTINGS: AdminSettings = { recordingLimitMinutes: 120, updatedAt: '2026-10-20T10:00:00.000Z', updatedBy: 'boss@example.com' };
  const LIST: AdminList = {
    admins: [
      { id: ME.id, email: 'boss@example.com', name: 'Boss', isOwner: true },
      { id: null, email: 'ghost@example.com', name: null, isOwner: true },
      { id: ANN, email: 'ann@example.com', name: 'Ann', isOwner: false },
    ],
  };

  it('changes the global recording limit', async () => {
    let current = SETTINGS;
    const updateAdminSettings = vi.fn(async (body: { recordingLimitMinutes: number }) => (current = { ...SETTINGS, ...body }));
    renderWithProviders(<AdminSettingsView />, {
      auth: authValue({ api: fakeApi({ me: vi.fn(async () => ME), adminSettings: vi.fn(async () => current), updateAdminSettings, adminList: vi.fn(async () => LIST) }) }),
    });
    const limit = await screen.findByRole('region', { name: 'Recording limit' });
    expect(await within(limit).findByText(/Now: 2 h · changed by boss@example.com/)).toBeInTheDocument();
    fireEvent.change(within(limit).getByRole('spinbutton', { name: 'Minutes' }), { target: { value: '90' } });
    fireEvent.click(within(limit).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(updateAdminSettings).toHaveBeenCalledWith({ recordingLimitMinutes: 90 }));
    expect(await within(limit).findByText(/Now: 1 h 30 min/)).toBeInTheDocument();
    fireEvent.click(within(limit).getByRole('checkbox', { name: 'No limit' }));
    fireEvent.click(within(limit).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(updateAdminSettings).toHaveBeenLastCalledWith({ recordingLimitMinutes: 0 }));
  });

  it('lists admins, adds one by email and removes one', async () => {
    const grantAdmin = vi.fn(async () => Promise.reject(new Error('No account with that email yet. They need to sign in to BoringTalks once first.')));
    const updateAdminUser = vi.fn(async () => detail());
    renderWithProviders(<AdminSettingsView />, {
      auth: authValue({ api: fakeApi({ me: vi.fn(async () => ME), adminSettings: vi.fn(async () => SETTINGS), adminList: vi.fn(async () => LIST), grantAdmin, updateAdminUser }) }),
    });
    const list = await screen.findByRole('list', { name: 'Admin list' });
    expect(within(list).getAllByText('owner')).toHaveLength(2);
    expect(within(list).getByText('hasn’t signed in yet')).toBeInTheDocument();
    expect(within(list).getByText('you')).toBeInTheDocument();
    expect(within(list).getAllByRole('button', { name: 'Remove' })).toHaveLength(1);

    fireEvent.change(screen.getByLabelText('Add an admin'), { target: { value: 'new@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('sign in to BoringTalks once first');
    expect(grantAdmin).toHaveBeenCalledWith('new@example.com');

    fireEvent.click(within(list).getByRole('button', { name: 'Remove' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(updateAdminUser).toHaveBeenCalledWith(ANN, { isAdmin: false }));
  });
});
