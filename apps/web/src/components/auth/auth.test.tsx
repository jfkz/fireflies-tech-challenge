import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authValue, renderWithProviders } from '@/test/utils';
import { safeContinue } from '@/lib/auth-errors';
import { AuthAction, AuthForm, ResetForm } from './AuthForm';
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

describe('AuthAction (the page Firebase’s reset emails link to)', () => {
  const reset = (extra: Record<string, string> = {}) => new URLSearchParams({ mode: 'resetPassword', oobCode: 'CODE', ...extra });

  it('sets the new password, then signs in and opens the meetings', async () => {
    nav.search = reset({ continueUrl: `${window.location.origin}/signin` });
    const auth = authValue({ user: null });
    renderForm(<AuthAction />, auth);
    expect(await screen.findByText('me@example.com')).toBeInTheDocument();
    expect(auth.checkResetCode).toHaveBeenCalledWith('CODE');
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'better1' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Save password' }).closest('form')!);
    expect(await screen.findByRole('status')).toHaveTextContent('Your password is changed. Signing you in…');
    expect(auth.confirmReset).toHaveBeenCalledWith('CODE', 'better1');
    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith('/meetings'));
    expect(auth.signIn).toHaveBeenCalledWith('me@example.com', 'better1');
  });

  it('started on the dev site: goes back there to sign in', async () => {
    nav.search = reset({ continueUrl: 'https://dev.boringtalks.lol/signin' });
    const auth = authValue({ user: null });
    renderForm(<AuthAction />, auth);
    fireEvent.change(await screen.findByLabelText('New password'), { target: { value: 'better1' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Save password' }).closest('form')!);
    expect(await screen.findByRole('link', { name: 'Sign in with it' })).toHaveAttribute('href', 'https://dev.boringtalks.lol/signin');
    expect(auth.signIn).not.toHaveBeenCalled();
  });

  it('falls back to the sign-in page when signing in afterwards fails', async () => {
    nav.search = reset();
    const auth = authValue({ user: null, signIn: vi.fn(async () => Promise.reject({ code: 'auth/network-request-failed' })) });
    renderForm(<AuthAction />, auth);
    fireEvent.change(await screen.findByLabelText('New password'), { target: { value: 'better1' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Save password' }).closest('form')!);
    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith('/signin'));
  });

  it('says when the link is used up, and offers a new one', async () => {
    nav.search = reset();
    renderForm(<AuthAction />, authValue({ user: null, checkResetCode: vi.fn(async () => Promise.reject({ code: 'auth/invalid-action-code' })) }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already used');
    expect(screen.getByRole('link', { name: 'Send a new link' })).toHaveAttribute('href', '/reset');
  });

  it('shows why saving failed and lets you try again', async () => {
    nav.search = reset();
    const auth = authValue({ user: null, confirmReset: vi.fn(async () => Promise.reject({ code: 'auth/weak-password' })) });
    renderForm(<AuthAction />, auth);
    fireEvent.change(await screen.findByLabelText('New password'), { target: { value: 'abcdef' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Save password' }).closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent('at least 6 characters');
    expect(screen.getByRole('button', { name: 'Save password' })).toBeEnabled();
  });

  it('explains an incomplete link', () => {
    nav.search = new URLSearchParams({ mode: 'resetPassword' });
    renderForm(<AuthAction />);
    expect(screen.getByRole('heading', { name: 'That link is incomplete' })).toBeInTheDocument();
  });

  it('hands other actions to Firebase’s own page on our domain', () => {
    const replace = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, replace } });
    try {
      nav.search = new URLSearchParams({ mode: 'verifyEmail', oobCode: 'V', apiKey: 'k' });
      renderForm(<AuthAction />);
      expect(replace).toHaveBeenCalledWith('/__/auth/action?mode=verifyEmail&oobCode=V&apiKey=k');
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });
});

describe('safeContinue', () => {
  it('only returns to our own sites', () => {
    expect(safeContinue('https://dev.boringtalks.lol/signin')?.href).toBe('https://dev.boringtalks.lol/signin');
    expect(safeContinue('https://boringtalks.lol/signin')?.hostname).toBe('boringtalks.lol');
    expect(safeContinue('http://localhost:3210/signin')?.port).toBe('3210');
    expect(safeContinue('http://boringtalks.lol/signin')).toBeNull();
    expect(safeContinue('https://evil.test/signin')).toBeNull();
    expect(safeContinue('https://boringtalks.lol.evil.test/')).toBeNull();
    expect(safeContinue('https://user:pw@boringtalks.lol/')).toBeNull();
    expect(safeContinue('javascript:alert(1)')).toBeNull();
    expect(safeContinue('not a url')).toBeNull();
    expect(safeContinue(null)).toBeNull();
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
