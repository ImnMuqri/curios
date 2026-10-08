'use client';

import { useState, type FormEvent } from 'react';
import { Button, Callout, Field } from '@curios/ui';
import { AuthShell } from '../_auth/AuthShell.js';
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
    return (
      <AuthShell title="Password changed" switchTo={{ prompt: 'All set.', label: 'Sign in', href: '/signin' }}>
        <Callout tone="info">
          Your password has changed, and you have been signed out everywhere.
        </Callout>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Choose a new password">
      <form onSubmit={(event) => void submit(event)}>
        <Field
          id="password"
          label="New password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={setPassword}
        />

        {error ? <Callout tone="error">{error}</Callout> : null}

        <Button type="submit" busy={busy}>
          {busy ? 'Changing…' : 'Change my password'}
        </Button>
      </form>
    </AuthShell>
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
