'use client';

import { useState, type FormEvent } from 'react';
import { apiFetch } from '../../lib/api.js';

export function ForgotForm({
  onSubmit,
}: {
  onSubmit: (input: { email: string }) => Promise<unknown>;
}) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await onSubmit({ email });
      setDone(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Something failed. Try again.');
      setBusy(false);
    }
  }

  if (done) {
    // Identical whether or not the address has an account with a password --
    // the API's response is byte-identical in both cases, and this screen
    // must not leak what the API refuses to.
    return <p role="status">If that address has an account, check your email for a link to reset your password.</p>;
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

      {error ? <p role="alert">{error}</p> : null}

      <button type="submit" disabled={busy}>
        {busy ? 'Sending…' : 'Send reset link'}
      </button>
    </form>
  );
}

/**
 * Supplies the real submit handler. Thin on purpose, same reasoning as
 * `SignIn` in `signin-form.tsx`: what this actually does is covered by
 * Task 3's manual walk-through and by the API's own tests of
 * POST /auth/forgot-password.
 */
export function Forgot() {
  return (
    <ForgotForm
      onSubmit={(input) =>
        apiFetch('/auth/forgot-password', { method: 'POST', body: JSON.stringify(input) })
      }
    />
  );
}
