'use client';

import { useState, type FormEvent } from 'react';
import { Button, Callout, Field } from '@curios/ui';
import { AuthShell } from '../_auth/AuthShell.js';
import { apiFetch } from '../../lib/api.js';
import styles from '../auth.module.css';

export function SignUpForm({
  onSubmit,
}: {
  onSubmit: (input: { email: string; password: string }) => Promise<unknown>;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Success is a state, not a redirect: the API answers 202 and issues no
  // session, because an unverified account is inert -- there is nothing to
  // redirect to yet.
  const [done, setDone] = useState(false);

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
    // not leak what the API refuses to.
    return (
      <AuthShell title="Check your email">
        <Callout tone="info">
          Check your email to confirm your address and finish signing up.
        </Callout>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your free page"
      lede="Answering is free on every plan. No card needed."
      switchTo={{ prompt: 'Already have a page?', label: 'Sign in', href: '/signin' }}
    >
      <form onSubmit={(event) => void submit(event)}>
        <Field
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
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

        {/* An anchor, never a button: it must leave the app for the API
            origin, and a fetch would follow that redirect in the background. */}
        <a
          className={styles.alternative}
          href={`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/auth/google`}
        >
          Continue with Google
        </a>
      </form>
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
