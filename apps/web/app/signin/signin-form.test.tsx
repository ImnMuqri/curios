import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
