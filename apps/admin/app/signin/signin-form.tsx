'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '../../lib/api.js';
import styles from './signin.module.css';

/** The form itself; `onSubmit` is injected so a test never needs the network. */
export function SignInForm({ onSubmit }: { onSubmit: (email: string, password: string) => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(email, password);
    } catch (err) {
      // The API sends one message for every cause; render it verbatim.
      setError(err instanceof ApiError ? err.message : 'Something failed. Try again.');
      setBusy(false);
    }
  }

  return (
    <main className={styles.page}>
      <form className={styles.card} onSubmit={(event) => void submit(event)}>
        <p className={styles.tag}>Admin</p>
        <h1>Curios admin</h1>
        <label htmlFor="admin-email">Email</label>
        <input
          id="admin-email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <label htmlFor="admin-password">Password</label>
        <input
          id="admin-password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error ? (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={busy}>
          Sign in
        </button>
      </form>
    </main>
  );
}

/** Posts to the API, then lands on Overview. */
export function SignIn() {
  const router = useRouter();
  return (
    <SignInForm
      onSubmit={async (email, password) => {
        await apiFetch('/admin/signin', { method: 'POST', body: JSON.stringify({ email, password }) });
        router.replace('/');
      }}
    />
  );
}
