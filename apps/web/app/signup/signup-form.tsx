'use client';

import { useState, type FormEvent } from 'react';
import { apiFetch } from '../../lib/api.js';

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
    return <p role="status">Check your email to confirm your address and finish signing up.</p>;
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <label htmlFor="email">Email</label>
      <input
        id="email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />

      <label htmlFor="password">Password</label>
      <input
        id="password"
        type="password"
        autoComplete="new-password"
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />

      {error ? <p role="alert">{error}</p> : null}

      <button type="submit" disabled={busy}>
        {busy ? 'Signing up…' : 'Sign up'}
      </button>

      <a href={`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/auth/google`}>
        Continue with Google
      </a>
    </form>
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
