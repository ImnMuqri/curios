import { describe, expect, it, vi } from 'vitest';
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

    await userEvent.type(screen.getByLabelText('Email'), 'nadia@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'a-long-enough-passphrase');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    // The API deliberately returns one message for every cause, including an
    // unverified address. The screen renders it verbatim rather than
    // interpreting it, because interpreting it is how the enumeration oracle
    // gets rebuilt in the client.
    expect(
      await screen.findByText(/check your email and password/i),
    ).toBeInTheDocument();
  });

  it('shows the Curios loader, "Signing you in", while the sign-in goes through, and clears it on a failure', async () => {
    let fail: (reason: Error) => void = () => {};
    const submit = vi.fn(() => new Promise<void>((_, reject) => (fail = reject)));
    render(<SignInForm onSubmit={submit} />);
    expect(document.querySelector('[data-curios-loader]')).toBeNull();

    await userEvent.type(screen.getByLabelText('Email'), 'nadia@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'a-long-enough-passphrase');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(document.querySelector('[data-curios-loader]')).toHaveTextContent('Signing you in');

    fail(new Error('Nope.'));
    expect(await screen.findByText('Nope.')).toBeInTheDocument();
    expect(document.querySelector('[data-curios-loader]')).toBeNull();
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

    await userEvent.type(screen.getByLabelText('Email'), 'nadia@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'passphrase');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    // A double-tap on a slow phone is two sign-in attempts against a limiter
    // that counts both.
    expect(screen.getByRole('button', { name: /signing in/i })).toBeDisabled();
    release();
  });
});

describe('SignInForm: the Site board layout', () => {
  const order = (a: HTMLElement, b: HTMLElement) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING;

  it('reads "Welcome back." over the email form, then "or", then Google', () => {
    render(<SignInForm onSubmit={vi.fn()} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Welcome back.' })).toBeInTheDocument();
    expect(screen.getByText('Sign in to see your leads and what customers keep asking.')).toBeInTheDocument();

    const email = screen.getByLabelText('Email');
    const password = screen.getByLabelText('Password');
    const submit = screen.getByRole('button', { name: 'Sign in' });
    const or = screen.getByText('or');
    const google = screen.getByRole('link', { name: /continue with google/i });
    expect(order(email, password)).toBeTruthy();
    expect(order(password, submit)).toBeTruthy();
    expect(order(submit, or)).toBeTruthy();
    expect(order(or, google)).toBeTruthy();
  });

  it('draws fields with placeholders and keeps their labels and autocomplete for assistive tech', () => {
    render(<SignInForm onSubmit={vi.fn()} />);
    const email = screen.getByLabelText('Email');
    const password = screen.getByLabelText('Password');
    expect(email).toHaveAttribute('placeholder', 'Email');
    expect(email).toHaveAttribute('autocomplete', 'email');
    expect(password).toHaveAttribute('placeholder', 'Password');
    expect(password).toHaveAttribute('autocomplete', 'current-password');
  });

  it('puts "Forgot?" inside the password pill, and the sign-up link under the form', () => {
    render(<SignInForm onSubmit={vi.fn()} />);
    const forgot = screen.getByRole('link', { name: 'Forgot your password?' });
    expect(forgot).toHaveTextContent('Forgot?');
    expect(forgot.parentElement).toContainElement(screen.getByLabelText('Password'));
    expect(screen.getByText(/New to Curios\?/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create your free page' })).toHaveAttribute('href', '/signup');
  });

  it('ties a failure to both fields with aria-describedby', async () => {
    render(<SignInForm onSubmit={vi.fn().mockRejectedValue(new Error('Check your email and password.'))} />);
    await userEvent.type(screen.getByLabelText('Email'), 'nadia@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'passphrase');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    const alert = await screen.findByRole('alert');
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-describedby', alert.id);
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-describedby', alert.id);
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true');
  });

  it('has Peek over the email pill, covering his eyes while the password has the cursor', async () => {
    const { container } = render(<SignInForm onSubmit={vi.fn()} />);
    const peek = () => container.querySelector('[data-auth-peek]');
    expect(peek()).toHaveAttribute('data-auth-peek', 'follow');
    await userEvent.click(screen.getByLabelText('Password'));
    expect(peek()).toHaveAttribute('data-auth-peek', 'shy');
    await userEvent.click(screen.getByLabelText('Email'));
    expect(peek()).toHaveAttribute('data-auth-peek', 'follow');
  });

  it('wears the landing nav and the small footer, and no side panel', () => {
    const { container } = render(<SignInForm onSubmit={vi.fn()} />);
    expect(screen.getByRole('navigation', { name: 'Sections' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Make your page' })).toHaveAttribute('href', '/signup');
    const footer = screen.getByRole('contentinfo');
    expect(footer).toHaveTextContent('© Curios');
    expect(within(footer).getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms');
    expect(within(footer).getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
    expect(within(footer).getByRole('link', { name: 'Bahasa Melayu' })).toHaveAttribute('href', '/ms');
    expect(container.querySelector('aside')).toBeNull();
  });

  it('no longer marks a "Last used" method (the board has no badge, DEVIATIONS 385)', async () => {
    window.localStorage.clear();
    render(<SignInForm onSubmit={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('Email'), 'nadia@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'passphrase');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.queryByText('Last used')).not.toBeInTheDocument();
    expect(window.localStorage.getItem('curios.signin.last')).toBeNull();
  });
});
