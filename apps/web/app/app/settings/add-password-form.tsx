'use client';

import { useState, type FormEvent } from 'react';
import { apiFetch } from '../../../lib/api.js';

/**
 * Presentational half of the wrapper split -- `AddPassword` below supplies
 * the real `onAdd`. Same shape as `PublishButton`, the newest and smallest
 * example: a `done` state that replaces the form with a confirmation rather
 * than navigating anywhere, because this screen already IS where the account
 * lives.
 */
export function AddPasswordForm({
  onAdd,
}: {
  onAdd: (input: { password: string }) => Promise<unknown>;
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
      await onAdd({ password });
      setDone(true);
    } catch (failure) {
      // Rendered verbatim -- PASSWORD_ALREADY_SET says to use the reset flow
      // instead, and WEAK_PASSWORD's message is either "too short" or "seen
      // in a public breach". Rewriting either here would throw away the
      // reason.
      setError(failure instanceof Error ? failure.message : 'Something failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return <p role="status">Password added. You can now sign in with your email and this password.</p>;
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
        {busy ? 'Adding…' : 'Add password'}
      </button>
    </form>
  );
}

/**
 * Supplies the real submit handler. Thin on purpose, same reasoning as
 * `Publish` in `publish-button.tsx`: `page.tsx` is a Server Component and may
 * not pass a function to a Client Component, so the closure over `apiFetch`
 * is built here, entirely on the client side of that boundary.
 */
export function AddPassword() {
  return (
    <AddPasswordForm
      onAdd={(input) => apiFetch('/auth/password', { method: 'POST', body: JSON.stringify(input) })}
    />
  );
}
