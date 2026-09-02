'use client';

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../lib/api.js';

type Status = 'working' | 'confirmed' | 'failed';

/**
 * Posts the verification token exactly once.
 *
 * The token is single-use, so a second POST spends it and reports failure on
 * a link that actually worked. React's development StrictMode double-invokes
 * effects, so the empty-dependency `useEffect` alone is not enough -- the
 * `posted` ref guards against that second invocation too.
 */
export function VerifyClient({
  token,
  verify,
}: {
  token: string | undefined;
  verify: (token: string) => Promise<unknown>;
}) {
  const [status, setStatus] = useState<Status>('working');
  const [error, setError] = useState('');
  const posted = useRef(false);

  useEffect(() => {
    if (!token) return;
    if (posted.current) return;
    posted.current = true;

    verify(token)
      .then(() => setStatus('confirmed'))
      .catch((failure: unknown) => {
        setError(failure instanceof Error ? failure.message : 'Something failed. Try again.');
        setStatus('failed');
      });
    // Empty dependency array: this must run once for the life of the page,
    // not once per render of `token` or `verify`.
  }, []);

  if (!token) {
    // Mail clients truncate long URLs. This is a real way to arrive here.
    return <p role="alert">That link looks incomplete. Copy the whole link from the email, or request a new one.</p>;
  }

  if (status === 'working') {
    return <p role="status">Confirming your address…</p>;
  }

  if (status === 'failed') {
    return <p role="alert">{error}</p>;
  }

  return (
    <div>
      <p role="status">Your email is confirmed.</p>
      <a href="/signin">Sign in</a>
    </div>
  );
}

/**
 * Supplies the real `verify` function. Thin on purpose, same reasoning as
 * `SignIn` in `signin-form.tsx`.
 *
 * A Server Component cannot pass a closure as a prop to a Client Component --
 * functions are not serialisable across that boundary -- so `page.tsx` (a
 * Server Component, because it reads `searchParams`) renders this wrapper
 * with only the `token` string, and the closure over `apiFetch` is built
 * here, entirely on the client side of that boundary.
 */
export function Verify({ token }: { token: string | undefined }) {
  return (
    <VerifyClient
      token={token}
      verify={(t) => apiFetch('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token: t }) })}
    />
  );
}
