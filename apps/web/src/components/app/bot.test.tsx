import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authValue, fakeApi, meeting, renderWithProviders } from '@/test/utils';
import { MeetingView } from './MeetingView';
import { SendBotPanel } from './SendBotPanel';

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => nav,
  usePathname: () => '/record',
  useSearchParams: () => new URLSearchParams(),
}));

beforeEach(() => nav.push.mockReset());

describe('SendBotPanel', () => {
  it('only accepts meeting links, sends the bot and opens the meeting', async () => {
    const sendBot = vi.fn(async () => meeting({ id: '00000000-0000-4000-8000-0000000000b1', source: 'bot' }));
    renderWithProviders(<SendBotPanel />, { auth: authValue({ api: fakeApi({ sendBot }) }) });
    const link = screen.getByLabelText('Meeting link');
    const submit = screen.getByRole('button', { name: 'Send the notetaker' });
    fireEvent.change(link, { target: { value: 'https://example.com/call' } });
    expect(screen.getByText('Paste a Zoom, Google Meet, Microsoft Teams or Webex link.')).toBeInTheDocument();
    expect(submit).toBeDisabled();

    fireEvent.change(link, { target: { value: ' https://meet.google.com/abc-defg-hij ' } });
    fireEvent.change(screen.getByLabelText('Title (optional)'), { target: { value: 'Board call' } });
    fireEvent.click(submit);
    await waitFor(() => expect(sendBot).toHaveBeenCalledWith({ meetingUrl: 'https://meet.google.com/abc-defg-hij', title: 'Board call', joinAt: undefined }, expect.anything()));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/meetings/00000000-0000-4000-8000-0000000000b1'));
  });

  it('schedules a bot for later and shows errors', async () => {
    const sendBot = vi.fn(async () => Promise.reject(new Error('The bot can’t join: Invalid meeting URL')));
    renderWithProviders(<SendBotPanel />, { auth: authValue({ api: fakeApi({ sendBot }) }) });
    fireEvent.change(screen.getByLabelText('Meeting link'), { target: { value: 'https://zoom.us/j/1' } });
    fireEvent.click(screen.getByLabelText('Join at', { selector: 'input[type="radio"]' }));
    const submit = screen.getByRole('button', { name: 'Schedule the notetaker' });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Join at', { selector: 'input[type="datetime-local"]' }), { target: { value: '2099-01-02T10:30' } });
    fireEvent.click(submit);
    await waitFor(() =>
      expect(sendBot).toHaveBeenCalledWith(expect.objectContaining({ joinAt: new Date('2099-01-02T10:30').toISOString() }), expect.anything()),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid meeting URL');
  });
});

describe('bot banner on the meeting page', () => {
  it('says where the bot is and calls it back', async () => {
    const m = meeting({ status: 'recording', source: 'bot', summary: null, segments: [], bot: { status: 'waiting_room', meetingUrl: 'https://zoom.us/j/1', joinAt: null } });
    const leaveBot = vi.fn(async () => ({ ...m, bot: { ...m.bot!, status: 'left' as const } }));
    renderWithProviders(<MeetingView id={m.id} />, { auth: authValue({ api: fakeApi({ getMeeting: vi.fn(async () => m), leaveBot }) }) });
    const banner = await screen.findByTestId('bot-banner');
    expect(banner).toHaveTextContent('waiting room');
    expect(screen.getByRole('link', { name: 'Open the meeting' })).toHaveAttribute('href', 'https://zoom.us/j/1');
    fireEvent.click(screen.getByRole('button', { name: 'Make it leave' }));
    await waitFor(() => expect(leaveBot).toHaveBeenCalledWith(m.id));
    expect(await screen.findByText(/left the call/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Make it leave' })).toBeNull();
  });

  it('offers to cancel a scheduled bot', async () => {
    const m = meeting({ status: 'recording', source: 'bot', summary: null, segments: [], bot: { status: 'scheduled', meetingUrl: 'https://zoom.us/j/1', joinAt: '2099-01-02T10:30:00.000Z' } });
    renderWithProviders(<MeetingView id={m.id} />, { auth: authValue({ api: fakeApi({ getMeeting: vi.fn(async () => m) }) }) });
    expect(await screen.findByRole('button', { name: 'Cancel the notetaker' })).toBeInTheDocument();
    expect(screen.getByTestId('bot-banner')).toHaveTextContent('2099');
  });
});
