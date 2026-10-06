import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authValue, renderWithProviders } from '@/test/utils';
import { AuthForm, ResetForm } from './AuthForm';
import { AuthMoodProvider, DOZE_AFTER_MS, SleepyHead } from './AuthMood';

const nav = vi.hoisted(() => ({ router: { push: vi.fn(), replace: vi.fn() }, search: new URLSearchParams() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav.router, usePathname: () => '/signin', useSearchParams: () => nav.search }));

beforeEach(() => {
  nav.router.replace.mockReset();
  nav.search = new URLSearchParams();
});

function renderForm(ui: React.ReactElement, auth = authValue({ user: null })) {
  return renderWithProviders(
    <AuthMoodProvider>
      {ui}
      <SleepyHead />
    </AuthMoodProvider>,
    { auth },
  );
}

describe('AuthForm', () => {
  it('signs in with email and password', async () => {
    const auth = authValue({ user: null });
    renderForm(<AuthForm mode="signin" />, auth);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: ' me@example.com ' } });
    expect(screen.getByText('Oh! Hi. Go on, I’m listening.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret1' } });
    expect(screen.getByText('I’m not looking. Promise.')).toBeInTheDocument();
    fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }).closest('form')!);
    await waitFor(() => expect(auth.signIn).toHaveBeenCalledWith('me@example.com', 'secret1'));
    expect(await screen.findByText('You’re in!')).toBeInTheDocument();
  });

  it('creates an account', async () => {
    const auth = authValue({ user: null });
    renderForm(<AuthForm mode="signup" />, auth);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret1' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Create account' }).closest('form')!);
    await waitFor(() => expect(auth.signUp).toHaveBeenCalledWith('new@example.com', 'secret1'));
    expect(screen.getByText('At least 6 characters.')).toBeInTheDocument();
  });

  it('shows Firebase errors in plain words', async () => {
    const auth = authValue({ user: null, signIn: vi.fn(async () => Promise.reject({ code: 'auth/invalid-credential' })) });
    renderForm(<AuthForm mode="signin" />, auth);
    fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }).closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong email or password.');
    expect(screen.getByText('Hmm. That didn’t work.')).toBeInTheDocument();
  });

  it('continues with Google', async () => {
    const auth = authValue({ user: null });
    renderForm(<AuthForm mode="signin" />, auth);
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    await waitFor(() => expect(auth.signInWithGoogle).toHaveBeenCalled());
  });

  it('sends a signed-in user to next, and keeps next on the other form', () => {
    nav.search = new URLSearchParams({ next: '/connect?challenge=abc' });
    renderForm(<AuthForm mode="signin" />, authValue());
    expect(nav.router.replace).toHaveBeenCalledWith('/connect?challenge=abc');
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute('href', '/signup?next=%2Fconnect%3Fchallenge%3Dabc');
  });

  it('ignores off-site next values', () => {
    nav.search = new URLSearchParams({ next: 'https://evil.test' });
    renderForm(<AuthForm mode="signup" />, authValue());
    expect(nav.router.replace).toHaveBeenCalledWith('/meetings');
  });
});

describe('ResetForm', () => {
  it('sends a reset link', async () => {
    nav.search = new URLSearchParams({ email: 'me@example.com' });
    const auth = authValue({ user: null });
    renderForm(<ResetForm />, auth);
    expect(screen.getByLabelText('Email')).toHaveValue('me@example.com');
    fireEvent.submit(screen.getByRole('button', { name: 'Send reset link' }).closest('form')!);
    expect(await screen.findByRole('status')).toHaveTextContent('a reset link is on its way');
    expect(auth.resetPassword).toHaveBeenCalledWith('me@example.com');
  });

  it('shows errors', async () => {
    const auth = authValue({ user: null, resetPassword: vi.fn(async () => Promise.reject({ code: 'auth/invalid-email' })) });
    renderForm(<ResetForm />, auth);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'nope' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Send reset link' }).closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent('doesn’t look right');
  });
});

describe('SleepyHead', () => {
  it('dozes off again after a while without typing', () => {
    vi.useFakeTimers();
    function Poker() {
      return null;
    }
    render(
      <AuthMoodProvider>
        <Poker />
        <SleepyHead />
      </AuthMoodProvider>,
    );
    expect(screen.getByText('It wakes up when you type.')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(DOZE_AFTER_MS));
    vi.useRealTimers();
  });
});
