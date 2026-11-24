'use client';

import { useEffect, useId, useState, type FormEvent } from 'react';
import { AuthShell, GoogleButton, Or } from '../_auth/AuthShell.js';
import { AuthPeek } from '../_auth/AuthPeek.js';
import { PillField } from '../_auth/PillField.js';
import { apiFetch } from '../../lib/api.js';
import { readWantedHandle } from '../../lib/wanted-handle.js';
import styles from '../auth.module.css';
import { SIGNUP_TITLE } from './signup-title.js';

export function SignUpForm({
  onSubmit,
  wantedHandle,
}: {
  onSubmit: (input: { email: string; password: string }) => Promise<unknown>;
  /** The address typed on the landing page, if any. Read from browser storage when left out. */
  wantedHandle?: string;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [handle, setHandle] = useState(wantedHandle ?? '');
  // Success is a state, not a redirect: the API answers 202 and issues no
  // session, because an unverified account is inert -- there is nothing to
  // redirect to yet.
  const [done, setDone] = useState(false);
  const [shy, setShy] = useState(false);
  const errorId = useId();

  // Browser storage only exists in the browser, so it is read after the first render.
  useEffect(() => {
    if (wantedHandle === undefined) setHandle(readWantedHandle());
  }, [wantedHandle]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await onSubmit({ email, password });
      setDone(true);
    } catch (failure) {
      // Rendered verbatim, same reasoning as sign-in: the API's message is
      // written to be shown as-is, and interpreting it here is how an
      // enumeration oracle gets rebuilt in the client.
      setError(failure instanceof Error ? failure.message : 'Something failed. Try again.');
      setBusy(false);
    }
  }

  if (done) {
    // Identical whether or not the address already had an account -- the
    // API's response is byte-identical in both cases, and this screen must
    // not leak what the API refuses to. It names only what was typed.
    return (
      <AuthShell title="Check your email." lede="Check your email to confirm your address and finish signing up.">
        <div className={styles.w}>
          <AuthPeek wave />
          <div className={`${styles.pil} ${styles.sentp}`}>
            <span className={styles.env} aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <rect x="3" y="5" width="18" height="14" rx="3" />
                <path d="M3.5 7l8.5 6 8.5-6" />
              </svg>
            </span>
            <span>
              Sent to <b>{email}</b>
            </span>
          </div>
        </div>
        {handle ? <p className={styles.fine}>Once you confirm, curios.my/{handle} is filled in for you.</p> : null}
        <p className={styles.fine}>
          Wrong address?{' '}
          <a
            href="/signup"
            onClick={(event) => {
              event.preventDefault();
              setDone(false);
              setBusy(false);
            }}
          >
            Start again
          </a>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={SIGNUP_TITLE}
      lede="Answering is free on every plan. No card needed."
      chip={
        handle ? (
          <p className={styles.chip}>
            <i aria-hidden="true">✓</i>
            We’ll fill in curios.my/{handle} for you
          </p>
        ) : undefined
      }
    >
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
          autoComplete="new-password"
          placeholder="Password, 8 characters or more"
          required
          value={password}
          onChange={setPassword}
          describedBy={error ? errorId : undefined}
          invalid={Boolean(error)}
          onFocus={() => setShy(true)}
          onBlur={() => setShy(false)}
        />

        {error ? (
          <p className={styles.error} id={errorId} role="alert">
            {error}
          </p>
        ) : null}

        <button type="submit" className={styles.go} disabled={busy} aria-busy={busy || undefined}>
          {busy ? 'Creating…' : 'Create my page'}
        </button>
      </form>

      <Or />
      <GoogleButton />

      <p className={styles.fine}>
        By creating a page you agree to our <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.
      </p>
      <p className={`${styles.fine} ${styles.phoneOnly}`}>
        Already have a page? <a href="/signin">Sign in</a>
      </p>
    </AuthShell>
  );
}

/**
 * Supplies the real submit handler. Thin on purpose, same reasoning as
 * `SignIn` in `signin-form.tsx`: what this actually does is covered by
 * Task 3's manual walk-through and by the API's own tests of POST
 * /auth/signup.
 */
export function SignUp() {
  return (
    <SignUpForm
      onSubmit={(input) => apiFetch('/auth/signup', { method: 'POST', body: JSON.stringify(input) })}
    />
  );
}
