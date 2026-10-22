'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Button, Callout, Field } from '@curios/ui';
import { AuthShell, GoogleButton, OrWithEmail } from '../_auth/AuthShell.js';
import { apiFetch } from '../../lib/api.js';
import { readWantedHandle } from '../../lib/wanted-handle.js';
import { Peek } from '../_peek/Peek.js';
import styles from '../auth.module.css';

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
      <AuthShell title="Check your email" lede="Check your email to confirm your address and finish signing up." scene="signup" handle={handle}>
        <span className={styles.mail} aria-hidden="true">
          <svg viewBox="0 0 24 24" width="38" height="38">
            <rect x="3" y="5" width="18" height="14" rx="3" />
            <path d="M3.5 7l8.5 6 8.5-6" />
          </svg>
        </span>
        <p className={styles.sentTo}>
          Sent to <b>{email}</b>.{handle ? <> Once you confirm, curios.my/{handle} is filled in for you.</> : null}
        </p>
        <p className={styles.footnote}>
          Wrong address?{' '}
          <a
            href="/signup"
            onClick={(event) => {
              event.preventDefault();
              setDone(false);
              setBusy(false);
            }}
          >
            Go back
          </a>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your free page"
      lede="Answering is free on every plan. No card needed."
      switchTo={{ prompt: 'Already have a page?', label: 'Sign in', href: '/signin' }}
      scene="signup"
      handle={handle}
    >
      {handle ? (
        <p className={styles.claimChip}>
          <i aria-hidden="true">✓</i>
          We’ll fill in curios.my/{handle} for you
        </p>
      ) : null}

      <GoogleButton />
      <OrWithEmail />

      <form onSubmit={(event) => void submit(event)}>
        <Field
          id="email"
          adornment={<Peek variant="auth" width={84} right={18} top={-18.8} />}
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
          autoComplete="new-password"
          required
          value={password}
          onChange={setPassword}
        />

        {error ? <Callout tone="error">{error}</Callout> : null}

        <Button type="submit" busy={busy}>
          {busy ? 'Creating…' : 'Create my page'}
        </Button>
      </form>

      <p className={styles.terms}>
        By creating a page you agree to the <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.
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
