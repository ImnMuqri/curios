'use client';

import { useState, type FormEvent } from 'react';
import { apiFetch } from '../../lib/api.js';

export function ResetForm({
  token,
  onReset,
}: {
  token: string;
  onReset: (input: { token: string; password: string }) => Promise<unknown>;
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await onReset({ token, password });
      setDone(true);
    } catch (failure) {
      // Rendered verbatim, same reasoning as sign-in: a weak-password
      // rejection carries the real reason (too short, or seen in a breach)
      // and rewriting it here would throw that reason away.
      setError(failure instanceof Error ? failure.message : 'Something failed. Try again.');
      setBusy(false);
    }
  }

  if (done) {
    // A completed reset deletes every session for the account -- the person
    // resetting under suspicion of compromise needs to be told that
    // happened, not left guessing.
    return <p role="status">Your password has changed, and you have been signed out everywhere.</p>;
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <label htmlFor="password">New password</label>
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
        {busy ? 'Changing…' : 'Change my password'}
      </button>
    </form>
  );
}

/**
 * Supplies the real submit handler. Thin on purpose, same reasoning as
 * `SignIn` in `signin-form.tsx`: what this actually does is covered by
 * Task 3's manual walk-through and by the API's own tests of
 * POST /auth/reset-password.
 */
export function Reset({ token }: { token: string }) {
  return (
    <ResetForm
      token={token}
      onReset={(input) =>
        apiFetch('/auth/reset-password', { method: 'POST', body: JSON.stringify(input) })
      }
    />
  );
}
