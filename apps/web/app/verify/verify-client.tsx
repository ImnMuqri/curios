'use client';

import { useEffect, useRef, useState } from 'react';
import { SystemCard, SystemShell, systemStyles as styles } from '../_system/SystemShell.js';
import { HourglassArt, LetterArt, VerifyingArt } from '../_system/art.js';
import { BadLink } from '../_system/BadLink.js';
import { useCountdown } from '../_system/use-countdown.js';
import { apiFetch, ApiError } from '../../lib/api.js';

type Who = { email: string; name: string | null };

/** "Your email is confirmed", with where the owner's email will go. */
export function Verified({ email, name }: Who) {
  const first = name?.trim().split(/\s+/)[0];
  return (
    <SystemShell>
      <SystemCard
        art={<LetterArt confirmed />}
        title="Your email is confirmed"
        lede={`Thanks${first ? `, ${first}` : ''}. Receipts, new orders and leads will come to ${email}.`}
      >
        <a className={`${styles.go} ${styles.next}`} href="/app/onboarding">
          Set up my page
        </a>
      </SystemCard>
    </SystemShell>
  );
}

/**
 * Posts the verification token exactly once.
 *
 * The token is single-use, so a second POST spends it and reports failure on
 * a link that actually worked. React's development StrictMode double-invokes
 * effects, so the empty-dependency `useEffect` alone is not enough -- the
 * `posted` ref guards against that second invocation too.
 */
export function VerifyClient({ token, email, name, verify }: Who & { token: string; verify: (token: string) => Promise<unknown> }) {
  const [status, setStatus] = useState<'working' | 'confirmed' | 'failed'>('working');
  const [error, setError] = useState('');
  const posted = useRef(false);

  useEffect(() => {
    if (posted.current) return;
    posted.current = true;

    verify(token)
      .then(() => setStatus('confirmed'))
      .catch((failure: unknown) => {
        // A link that went bad since the page looked at it (used in another
        // tab a moment ago) is the broken-link screen; anything else says why.
        setError(failure instanceof ApiError && failure.code === 'INVALID_TOKEN' ? '' : failure instanceof Error ? failure.message : 'Something failed. Try again.');
        setStatus('failed');
      });
    // Empty dependency array: this must run once for the life of the page,
    // not once per render of `token` or `verify`.
  }, []);

  if (status === 'confirmed') return <Verified email={email} name={name} />;
  if (status === 'failed') return <BadLink kind="verify" detail={error || undefined} />;

  return (
    <SystemShell>
      <SystemCard art={<VerifyingArt />} title="Verify your email" lede="Confirming your address…" ledeRole="status" />
    </SystemShell>
  );
}

/** "This link has expired": a fresh one, then a wait before another. */
export function ExpiredLink({ token, email, resend }: { token: string; email: string; resend: (token: string) => Promise<unknown> }) {
  const [wait, startWait] = useCountdown();
  const [error, setError] = useState('');

  async function send() {
    setError('');
    try {
      await resend(token);
      startWait();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Something failed. Try again.');
    }
  }

  return (
    <SystemShell>
      <SystemCard
        art={<HourglassArt />}
        title="This link has expired"
        lede={`Confirmation links last 24 hours. We can send a fresh one to ${email}.`}
      >
        {error ? (
          <p className={styles.alert} role="alert">
            {error}
          </p>
        ) : null}
        <button type="button" className={`${styles.go} ${styles.next}`} disabled={wait > 0} onClick={() => void send()}>
          {wait > 0 ? 'Sent. Check your inbox' : 'Send a new link'}
        </button>
        <a className={styles.ghost} href="/">
          I’ll do it later
        </a>
      </SystemCard>
    </SystemShell>
  );
}

/**
 * The wrappers below supply the real API calls. A Server Component cannot
 * pass a closure to a Client Component -- functions are not serialisable
 * across that boundary -- so `page.tsx` passes plain values and the closures
 * over `apiFetch` are built here.
 */
export function Verify({ token, email, name }: Who & { token: string }) {
  return (
    <VerifyClient
      token={token}
      email={email}
      name={name}
      verify={(t) => apiFetch('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token: t }) })}
    />
  );
}

export function Expired({ token, email }: { token: string; email: string }) {
  return (
    <ExpiredLink
      token={token}
      email={email}
      resend={(t) => apiFetch('/auth/verify-email/resend', { method: 'POST', body: JSON.stringify({ token: t }) })}
    />
  );
}
