'use client';

import { useEffect, useRef, useState } from 'react';
import { Callout } from '@curios/ui';
import { AuthShell } from '../_auth/AuthShell.js';
import { apiFetch } from '../../lib/api.js';
import styles from '../auth.module.css';

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
    return (
      <AuthShell title="Verify your email">
        <Callout tone="error">
          That link looks incomplete. Copy the whole link from the email, or request a new one.
        </Callout>
      </AuthShell>
    );
  }

  if (status === 'working') {
    return (
      <AuthShell title="Verify your email">
        <Callout tone="info">Confirming your address…</Callout>
      </AuthShell>
    );
  }

  if (status === 'failed') {
    return (
      <AuthShell title="Verify your email">
        <Callout tone="error">{error}</Callout>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Verify your email">
      <Callout tone="info">Your email is confirmed.</Callout>
      <a className={styles.alternative} href="/signin">
        Sign in
      </a>
    </AuthShell>
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
