import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api.js';
import { SignInForm } from './signin-form.js';

describe('SignInForm', () => {
  it('shows the API message when sign-in fails', async () => {
    const submit = vi.fn().mockRejectedValueOnce(
      new ApiError(401, 'INVALID_CREDENTIALS', 'Check your email and password. If you just signed up, confirm your address first.'),
    );
    render(<SignInForm onSubmit={submit} />);

    await userEvent.type(screen.getByLabelText(/email/i), 'nadia@example.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'a-long-enough-passphrase');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    // The API deliberately returns one message for every cause, including an
    // unverified address. The screen renders it verbatim rather than
    // interpreting it, because interpreting it is how the enumeration oracle
    // gets rebuilt in the client.
    expect(
      await screen.findByText(/check your email and password/i),
    ).toBeInTheDocument();
  });

  // /forgot existed from slice 2 with nothing linking to it, so an owner who
  // mistyped a password at signup had no way back in.
  it('links to the forgotten-password page', () => {
    render(<SignInForm onSubmit={vi.fn()} />);

    expect(screen.getByRole('link', { name: /forgot your password/i })).toHaveAttribute(
      'href',
      '/forgot',
    );
  });

  it('tells someone why they were sent here when they cancelled at Google', () => {
    render(<SignInForm onSubmit={vi.fn()} cancelled />);

    expect(screen.getByText(/sign-in was cancelled/i)).toBeInTheDocument();
  });

  it('explains a recognised OAuth failure using the shared message table', () => {
    // D2: the callback now redirects a failed Google sign-in here as
    // `?error=<code>`. This must render an explanation, not silently drop
    // the code the way the screen used to.
    render(<SignInForm onSubmit={vi.fn()} oauthError="oauth_state_mismatch" />);

    expect(screen.getByRole('alert')).toHaveTextContent(/no longer valid/i);
  });

  it('falls back to a generic sentence for an OAuth failure code it does not recognise', () => {
    render(<SignInForm onSubmit={vi.fn()} oauthError="something_nobody_has_seen_before" />);

    expect(screen.getByRole('alert')).toHaveTextContent(/try again/i);
  });

  it('disables the button while the request is in flight', async () => {
    let release: () => void = () => {};
    const submit = vi.fn(() => new Promise<void>((r) => (release = r)));
    render(<SignInForm onSubmit={submit} />);

    await userEvent.type(screen.getByLabelText(/email/i), 'nadia@example.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'passphrase');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    // A double-tap on a slow phone is two sign-in attempts against a limiter
    // that counts both.
    expect(screen.getByRole('button', { name: /signing in/i })).toBeDisabled();
    release();
  });
});

describe('SignInForm: "Last used"', () => {
  // Before, not after: the tests above sign in and leave email behind.
  beforeEach(() => window.localStorage.clear());

  const google = () => screen.getByRole('link', { name: /continue with google/i });
  const or = () => screen.getByText(/or with email/i);

  it('marks nothing on a first visit', () => {
    render(<SignInForm onSubmit={vi.fn()} />);
    expect(screen.queryByText('Last used')).not.toBeInTheDocument();
  });

  it('marks email after a sign-in by email succeeds, and not after one fails', async () => {
    const submit = vi.fn().mockRejectedValueOnce(new Error('Check your email and password.')).mockResolvedValueOnce(undefined);
    const { unmount } = render(<SignInForm onSubmit={submit} />);
    await userEvent.type(screen.getByLabelText(/email/i), 'nadia@example.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'passphrase');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await screen.findByText(/check your email and password/i);
    expect(window.localStorage.getItem('curios.signin.last')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    unmount();

    render(<SignInForm onSubmit={vi.fn()} />);
    expect(await within(or()).findByText('Last used')).toBeInTheDocument();
    expect(within(google()).queryByText('Last used')).not.toBeInTheDocument();
  });

  it('marks Google once a Google sign-in is followed by a visit Google did not send back cancelled', async () => {
    const { unmount } = render(<SignInForm onSubmit={vi.fn()} />);
    google().addEventListener('click', (event) => event.preventDefault());
    await userEvent.click(google());
    unmount();

    render(<SignInForm onSubmit={vi.fn()} />);
    expect(await within(google()).findByText('Last used')).toBeInTheDocument();
    expect(within(or()).queryByText('Last used')).not.toBeInTheDocument();
  });

  it('keeps the earlier method when Google sends the person back cancelled or failed', async () => {
    window.localStorage.setItem('curios.signin.last', 'email');
    for (const props of [{ cancelled: true }, { oauthError: 'oauth_state_mismatch' }]) {
      const { unmount } = render(<SignInForm onSubmit={vi.fn()} />);
      google().addEventListener('click', (event) => event.preventDefault());
      await userEvent.click(google());
      unmount();

      const back = render(<SignInForm onSubmit={vi.fn()} {...props} />);
      expect(await within(or()).findByText('Last used')).toBeInTheDocument();
      expect(within(google()).queryByText('Last used')).not.toBeInTheDocument();
      back.unmount();
    }
  });
});
