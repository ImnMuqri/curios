'use client';

import { useId, useState, type FormEvent } from 'react';
import { AuthShell } from '../_auth/AuthShell.js';
import { AuthPeek } from '../_auth/AuthPeek.js';
import { PillField } from '../_auth/PillField.js';
import { SystemActions, SystemCard, SystemShell, systemStyles as systemCss } from '../_system/SystemShell.js';
import { DoneArt } from '../_system/art.js';
import { BadLink } from '../_system/BadLink.js';
import { strength } from '../../lib/password-strength.js';
import { apiFetch, ApiError } from '../../lib/api.js';
import styles from '../auth.module.css';
import { Callout } from '@curios/ui';

/** Under the meter, as the board words each strength. */
const STRENGTH_TEXT = ['8 characters or more.', 'Too short. 8 characters or more.', 'Okay. A number makes it stronger.', 'Good.', 'Strong.'];

const EYE = 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z';

/**
 * Choose a new password, then "Password changed", from the Site board.
 *
 * A completed reset ends every other session for the account -- someone
 * resetting under suspicion of compromise must not leave the intruder in --
 * and keeps this device signed in, so "Go to my page" goes straight there.
 */
export function ResetForm({
  token,
  email,
  onReset,
}: {
  token: string;
  email: string;
  onReset: (input: { token: string; password: string }) => Promise<unknown>;
}) {
  const [password, setPassword] = useState('');
  const [shown, setShown] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<'form' | 'changed' | 'bad'>('form');
  const [focused, setFocused] = useState(false);
  const strengthId = useId();
  const errorId = useId();
  const level = strength(password);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password.length < 8) {
      setError('8 characters or more.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      await onReset({ token, password });
      setOutcome('changed');
    } catch (failure) {
      // The link went bad between opening it and submitting (spent in
      // another tab, or the hour ran out): the board's broken-link screen.
      if (failure instanceof ApiError && failure.code === 'INVALID_TOKEN') setOutcome('bad');
      // Otherwise verbatim: a weak-password refusal carries the real reason
      // (too short, or seen in a breach), and rewording it would lose that.
      else setError(failure instanceof Error ? failure.message : 'Something failed. Try again.');
      setBusy(false);
    }
  }

  if (outcome === 'bad') return <BadLink />;

  if (outcome === 'changed') {
    return (
      <SystemShell>
        <SystemCard art={<DoneArt />} title="Password changed" lede="You can sign in with it now, on any device.">
          <SystemActions>
            <a className={systemCss.go} href="/app">
              Go to my page
            </a>
          </SystemActions>
        </SystemCard>
      </SystemShell>
    );
  }

  return (
    <AuthShell title="Choose a new password." lede={`For ${email}. You’ll stay signed in on this device.`}>
      <form className={styles.fields} onSubmit={(event) => void submit(event)} noValidate>
        <PillField
          id="password"
          label="New password"
          type={shown ? 'text' : 'password'}
          autoComplete="new-password"
          placeholder="New password"
          required
          minLength={8}
          value={password}
          onChange={setPassword}
          describedBy={error ? `${strengthId} ${errorId}` : strengthId}
          invalid={Boolean(error)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          peek={<AuthPeek shy={focused && !shown} />}
          trailing={
            <button
              type="button"
              className={styles.eye}
              aria-label={shown ? 'Hide password' : 'Show password'}
              aria-pressed={shown}
              onClick={() => setShown(!shown)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d={EYE} />
              </svg>
            </button>
          }
        />
        <div className={styles.str} data-good={level >= 3 ? '' : undefined} aria-hidden="true">
          {[1, 2, 3, 4].map((bar) => (
            <i key={bar} data-on={bar <= level ? '' : undefined} />
          ))}
        </div>
        <p className={styles.strt} id={strengthId}>
          {STRENGTH_TEXT[level]}
        </p>
        {error ? (
          <div id={errorId}><Callout tone="error">
            {error}
          </Callout></div>
        ) : null}
        <button type="submit" className={styles.go} disabled={busy} aria-busy={busy || undefined}>
          {busy ? 'Changing…' : 'Change my password'}
        </button>
      </form>
    </AuthShell>
  );
}

/**
 * Supplies the real submit handler. Thin on purpose, same reasoning as
 * `SignIn` in `signin-form.tsx`: what this actually does is covered by the
 * API's own tests of POST /auth/reset-password.
 */
export function Reset({ token, email }: { token: string; email: string }) {
  return (
    <ResetForm
      token={token}
      email={email}
      onReset={(input) => apiFetch('/auth/reset-password', { method: 'POST', body: JSON.stringify(input) })}
    />
  );
}
