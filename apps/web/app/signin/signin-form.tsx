'use client';

import { useId, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Callout } from '@curios/ui';
import { AuthShell, GoogleButton, Or } from '../_auth/AuthShell.js';
import { AuthPeek } from '../_auth/AuthPeek.js';
import { PillField } from '../_auth/PillField.js';
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
  // Peek covers his eyes while the password has the cursor (the board's `shy`).
  const [shy, setShy] = useState(false);
  const errorId = useId();

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
    <AuthShell title="Welcome back." lede="Sign in to see your leads and what customers keep asking.">
      {cancelled ? <Callout tone="info">Sign-in was cancelled. Try again when you are ready.</Callout> : null}
      {oauthError ? <Callout tone="error">{oauthErrorMessage(oauthError)}</Callout> : null}

      <form className={styles.fields} onSubmit={(event) => void submit(event)}>
        <PillField
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="Email"
          required
          value={email}
          onChange={setEmail}
          describedBy={error ? errorId : undefined}
          peek={<AuthPeek shy={shy} />}
        />
        <PillField
          id="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          placeholder="Password"
          required
          value={password}
          onChange={setPassword}
          describedBy={error ? errorId : undefined}
          invalid={Boolean(error)}
          onFocus={() => setShy(true)}
          onBlur={() => setShy(false)}
          trailing={
            <a className={styles.aside} href="/forgot" aria-label="Forgot your password?">
              Forgot?
            </a>
          }
        />

        {/* Rendered verbatim. The API returns one message for every cause on
            purpose -- wrong password, unknown address, unverified -- and
            rewriting it here to be more helpful would rebuild the account
            enumeration oracle it was written to remove. */}
        {error ? (
          <p className={styles.error} id={errorId} role="alert">
            {error}
          </p>
        ) : null}

        <button type="submit" className={styles.go} disabled={busy} aria-busy={busy || undefined}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <Or />
      <GoogleButton />

      <p className={styles.fine}>
        New to Curios? <a href="/signup">Create your free page</a>
      </p>
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
