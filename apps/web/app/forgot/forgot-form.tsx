'use client';

import { useId, useState, type FormEvent } from 'react';
import { AuthShell } from '../_auth/AuthShell.js';
import { AuthPeek } from '../_auth/AuthPeek.js';
import { PillField } from '../_auth/PillField.js';
import { SystemActions, SystemCard, SystemShell, systemStyles as systemCss } from '../_system/SystemShell.js';
import { SentArt } from '../_system/art.js';
import { useCountdown } from '../_system/use-countdown.js';
import { apiFetch } from '../../lib/api.js';
import styles from '../auth.module.css';
import { Callout } from '@curios/ui';

const looksLikeEmail = (email: string) => /.+@.+\..+/.test(email);

/**
 * Forgot password (the auth layout), and the email-sent screen after it (a system screen), from the Site board.
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
  const errorId = useId();

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
    else setError('Enter your email address.');
  }

  if (sent) {
    return (
      <SystemShell>
        <SystemCard
          art={<SentArt />}
          title="Check your email"
          lede={
            <>
              If <b>{email}</b> has a Curios account, a link to choose a new password is on its way. It works for one hour.
            </>
          }
        >
          <SystemActions>
            <a className={systemCss.ghost} href="/signin">
              Back to sign in
            </a>
          </SystemActions>
          {error ? (
            <Callout tone="error">
              {error}
            </Callout>
          ) : null}
          <p className={systemCss.again}>
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
    <AuthShell title="Reset your password." lede="We will email you a link to choose a new one.">
      <form className={styles.fields} onSubmit={submit} noValidate>
        <PillField
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="Email"
          required
          value={email}
          onChange={(value) => setEmail(value.trim())}
          describedBy={error ? errorId : undefined}
          invalid={Boolean(error)}
          peek={<AuthPeek />}
        />
        {error ? (
          <div id={errorId}><Callout tone="error">
            {error}
          </Callout></div>
        ) : null}
        <button type="submit" className={styles.go} disabled={busy} aria-busy={busy || undefined}>
          {busy ? 'Sending…' : 'Send reset link'}
        </button>
      </form>
      <p className={styles.fine}>
        Remembered it? <a href="/signin">Sign in</a>
      </p>
    </AuthShell>
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
