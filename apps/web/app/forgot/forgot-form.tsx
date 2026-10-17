'use client';

import { useState, type FormEvent } from 'react';
import { SystemCard, SystemShell, systemStyles as styles } from '../_system/SystemShell.js';
import { ForgotArt, LetterArt } from '../_system/art.js';
import { useCountdown } from '../_system/use-countdown.js';
import { apiFetch } from '../../lib/api.js';

const looksLikeEmail = (email: string) => /.+@.+\..+/.test(email);

/**
 * Forgot password, and the email-sent screen after it, from the System board.
 *
 * The sent screen reads the same whether or not the address has an account
 * with a password -- the API's response is identical in both cases, and this
 * screen must not leak what the API refuses to.
 */
export function ForgotForm({ onSubmit }: { onSubmit: (input: { email: string }) => Promise<unknown> }) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [wait, startWait] = useCountdown();

  async function send() {
    setError('');
    setBusy(true);
    try {
      await onSubmit({ email });
      setSent(true);
      startWait();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Something failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (looksLikeEmail(email)) void send();
  }

  if (sent) {
    return (
      <SystemShell>
        <SystemCard
          art={<LetterArt />}
          title="Check your email"
          lede={
            <>
              If <b>{email}</b> has a Curios account, a link to choose a new password is on its way. It works for one hour.
            </>
          }
        >
          <a className={`${styles.ghost} ${styles.next}`} href="/signin">
            Back to sign in
          </a>
          {error ? (
            <p className={styles.alert} role="alert">
              {error}
            </p>
          ) : null}
          <p className={styles.again}>
            Nothing yet? Check spam, or{' '}
            <button type="button" disabled={wait > 0 || busy} onClick={() => void send()}>
              {wait > 0 ? `send again in 0:${String(wait).padStart(2, '0')}` : 'send it again'}
            </button>
          </p>
        </SystemCard>
      </SystemShell>
    );
  }

  return (
    <SystemShell>
      <SystemCard art={<ForgotArt />} title="Reset your password" lede="We will email you a link to choose a new one.">
        <form onSubmit={submit} noValidate>
          <label className={styles.fld}>
            <span>Email</span>
            <span className={styles.inp}>
              <input
                type="email"
                name="email"
                autoComplete="email"
                placeholder="you@example.com"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value.trim())}
              />
            </span>
          </label>
          {error ? (
            <p className={styles.alert} role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" className={styles.go} data-ready={looksLikeEmail(email) && !busy} disabled={busy}>
            {busy ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
        <p className={styles.sw}>
          Remembered it? <a href="/signin">Sign in</a>
        </p>
      </SystemCard>
    </SystemShell>
  );
}

/**
 * Supplies the real submit handler. Thin on purpose, same reasoning as
 * `SignIn` in `signin-form.tsx`: what this actually does is covered by the
 * API's own tests of POST /auth/forgot-password.
 */
export function Forgot() {
  return (
    <ForgotForm onSubmit={(input) => apiFetch('/auth/forgot-password', { method: 'POST', body: JSON.stringify(input) })} />
  );
}
