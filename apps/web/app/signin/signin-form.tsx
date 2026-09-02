'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../../lib/api.js';

export function SignInForm({
  onSubmit,
  cancelled = false,
}: {
  onSubmit: (input: { email: string; password: string }) => Promise<unknown>;
  cancelled?: boolean;
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
    <form onSubmit={(event) => void submit(event)}>
      {cancelled ? <p role="status">Sign-in was cancelled. Try again when you are ready.</p> : null}

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
        autoComplete="current-password"
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />

      {error ? <p role="alert">{error}</p> : null}

      <button type="submit" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>

      <a href={`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/auth/google`}>
        Continue with Google
      </a>
    </form>
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
export function SignIn({ cancelled, next }: { cancelled: boolean; next: string }) {
  const router = useRouter();

  return (
    <SignInForm
      cancelled={cancelled}
      onSubmit={async (input) => {
        await apiFetch('/auth/login', { method: 'POST', body: JSON.stringify(input) });
        router.push(next);
      }}
    />
  );
}
