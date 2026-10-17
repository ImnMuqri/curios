'use client';

import { useState, type FormEvent } from 'react';
import { SystemCard, SystemShell, systemStyles as styles } from '../_system/SystemShell.js';
import { ChangedArt, PadlockArt } from '../_system/art.js';
import { BadLink } from '../_system/BadLink.js';
import { strength } from '../../lib/password-strength.js';
import { apiFetch, ApiError } from '../../lib/api.js';

/** Under the meter, as the board words each strength. */
const STRENGTH_TEXT = ['8 characters or more.', 'Too short. 8 characters or more.', 'Okay. A number makes it stronger.', 'Good.', 'Strong.'];

const EYE = 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z';

/**
 * Choose a new password, then "Password changed", from the System board.
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
  const level = strength(password);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password.length < 8) return;
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
        <SystemCard art={<ChangedArt />} title="Password changed" lede="You can sign in with it now, on any device.">
          <a className={`${styles.go} ${styles.next}`} href="/app">
            Go to my page
          </a>
        </SystemCard>
      </SystemShell>
    );
  }

  return (
    <SystemShell>
      <SystemCard art={<PadlockArt />} title="Choose a new password" lede={`For ${email}. You’ll stay signed in on this device.`}>
        <form onSubmit={(event) => void submit(event)} noValidate>
          <label className={styles.fld}>
            <span>New password</span>
            <span className={styles.inp}>
              <input
                type={shown ? 'text' : 'password'}
                name="password"
                autoComplete="new-password"
                required
                minLength={8}
                aria-describedby="reset-strength"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
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
            </span>
          </label>
          <div className={styles.meter} data-strength={level} aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </div>
          <p className={styles.mtx} id="reset-strength">
            {STRENGTH_TEXT[level]}
          </p>
          {error ? (
            <p className={styles.alert} role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" className={styles.go} data-ready={password.length >= 8 && !busy} disabled={busy}>
            {busy ? 'Changing…' : 'Change my password'}
          </button>
        </form>
      </SystemCard>
    </SystemShell>
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
