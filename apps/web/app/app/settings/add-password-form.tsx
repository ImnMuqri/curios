'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { apiFetch } from '../../../lib/api.js';
import { strength } from '../../../lib/password-strength.js';
import { Done, SettingRow } from './setting-row.js';
import styles from './settings.module.css';

// The reset screen draws the same meter; the rule lives in lib/.
export { strength };

/**
 * The Password row for an account without one: "Add password" opens a field
 * under the row, and a saved password turns the row to "Added". This screen
 * already is where the account lives, so it confirms in place rather than
 * navigating anywhere.
 *
 * Presentational half of the wrapper split; `AddPassword` below supplies the
 * real `onAdd`.
 */
export function AddPasswordForm({ onAdd }: { onAdd: (input: { password: string }) => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) field.current?.focus();
  }, [open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      await onAdd({ password });
      setDone(true);
      setOpen(false);
      setPassword('');
    } catch (failure) {
      // Rendered verbatim -- PASSWORD_ALREADY_SET says to use the reset flow
      // instead, and WEAK_PASSWORD's message is either "too short" or "seen
      // in a public breach". Rewriting either here would throw away the
      // reason.
      setError(failure instanceof Error ? failure.message : 'Something failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const level = strength(password);

  return (
    <SettingRow
      icon="lock"
      tone="grey"
      title="Password"
      note={done ? 'Password added. You can now sign in with your email and this password.' : 'Not set. You sign in with Google only.'}
      action={
        done ? (
          <Done>Added</Done>
        ) : open ? null : (
          <button ref={opener} type="button" className={styles.btn2} onClick={() => setOpen(true)}>
            Add password
          </button>
        )
      }
      below={
        open ? (
          <form className={styles.pwf} onSubmit={(event) => void submit(event)}>
            <div className={styles.pwRow}>
              <input
                ref={field}
                className={styles.inp}
                type="password"
                autoComplete="new-password"
                aria-label="New password"
                placeholder="New password, 8 characters or more"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <button type="submit" className={styles.prim} disabled={busy}>
                {busy ? 'Adding…' : 'Add password'}
              </button>
              <button
                type="button"
                className={styles.btn2}
                disabled={busy}
                onClick={() => {
                  setOpen(false);
                  setPassword('');
                  setError('');
                  opener.current?.focus();
                }}
              >
                Cancel
              </button>
            </div>
            <div className={styles.meter} data-level={level} aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </div>
            {error ? (
              <p className={styles.error} role="alert">
                {error}
              </p>
            ) : null}
          </form>
        ) : null
      }
    />
  );
}

/**
 * Supplies the real submit handler. Thin on purpose: `page.tsx` is a Server
 * Component and may not pass a function to a Client Component, so the
 * closure over `apiFetch` is built here.
 */
export function AddPassword() {
  return <AddPasswordForm onAdd={(input) => apiFetch('/auth/password', { method: 'POST', body: JSON.stringify(input) })} />;
}
