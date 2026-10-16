'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Callout, Field } from '@curios/ui';
import { AuthShell, GoogleButton, OrWithEmail } from '../_auth/AuthShell.js';
import { apiFetch } from '../../lib/api.js';
import styles from '../auth.module.css';
import { oauthErrorMessage } from '../../lib/oauth-errors.js';

export function SignInForm({
  onSubmit,
  cancelled = false,
  oauthError,
}: {
  onSubmit: (input: { email: string; password: string }) => Promise<unknown>;
  cancelled?: boolean;
  /**
   * The `error` query param the OAuth callback redirects here with on a
   * failed Google sign-in -- D2. Named apart from the `error`/`setError`
   * state below, which is this form's own submit-failure message and an
   * unrelated thing. Never both this and `cancelled` at once in practice
   * (the callback picks one query string or the other), but neither depends
   * on that: each renders independently, off its own prop.
   */
  oauthError?: string;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await onSubmit({ email, password });
    } catch (failure) {
      // Rendered verbatim. The API returns one message for every cause on
      // purpose -- wrong password, unknown address, unverified -- and
      // rewriting it here to be more helpful would rebuild the account
      // enumeration oracle it was written to remove.
      setError(failure instanceof Error ? failure.message : 'Something failed. Try again.');
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Welcome back"
      lede="Sign in to see your leads and what customers keep asking."
      switchTo={{ prompt: 'New to Curios?', label: 'Create your free page', href: '/signup' }}
    >
      {cancelled ? (
        <Callout tone="info">Sign-in was cancelled. Try again when you are ready.</Callout>
      ) : null}
      {oauthError ? <Callout tone="error">{oauthErrorMessage(oauthError)}</Callout> : null}

      <GoogleButton />
      <OrWithEmail />

      <form onSubmit={(event) => void submit(event)}>
        <Field
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          required
          value={email}
          onChange={setEmail}
        />
        <Field
          id="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={setPassword}
          labelAside={
            <a className={styles.aside} href="/forgot">
              Forgot your password?
            </a>
          }
        />

        {/* Rendered verbatim. The API returns one message for every cause on
            purpose -- wrong password, unknown address, unverified -- and
            rewriting it here to be more helpful would rebuild the account
            enumeration oracle it was written to remove. */}
        {error ? <Callout tone="error">{error}</Callout> : null}

        <Button type="submit" busy={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthShell>
  );
}

/**
 * Supplies the real submit handler. Thin on purpose.
 *
 * A unit test of this would assert that a mocked fetch was called and a mocked
 * router was pushed, which proves the mocks work. What it actually does is
 * covered by Task 3's manual walk-through of the whole flow, and by the API's
 * own tests of POST /auth/login.
 */
export function SignIn({
  cancelled,
  next,
  error,
}: {
  cancelled: boolean;
  next: string;
  error?: string;
}) {
  const router = useRouter();

  return (
    <SignInForm
      cancelled={cancelled}
      oauthError={error}
      onSubmit={async (input) => {
        await apiFetch('/auth/login', { method: 'POST', body: JSON.stringify(input) });
        router.push(next);
      }}
    />
  );
}
