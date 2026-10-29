'use client';

import { useState, type ReactNode } from 'react';
import { apiFetch } from '../../lib/api.js';
import styles from './sign-out-button.module.css';

/**
 * Ends this session and leaves the dashboard.
 *
 * The session is ended first and the page left only after the API says so:
 * leaving on a failed call would show the sign-in screen to someone whose
 * cookie still works, which reads as signed out and is not.
 *
 * A full page load to /signin rather than a client-side push, so nothing the
 * dashboard held in memory survives into the next screen. `signOut` and
 * `navigate` are props so a test can stand in for the network and the browser,
 * the way pay-buttons.tsx does for its redirect.
 */
export function SignOutButton({
  signOut = async () => {
    await apiFetch('/auth/logout', { method: 'POST' });
  },
  navigate = (url: string) => window.location.assign(url),
  className,
  icon,
  role,
}: {
  signOut?: () => Promise<void>;
  navigate?: (url: string) => void;
  /** In place of the boxed button's own look: the account menu draws it as a red row. */
  className?: string | undefined;
  icon?: ReactNode;
  role?: 'menuitem';
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function onClick() {
    setBusy(true);
    setFailed(false);
    try {
      await signOut();
      navigate('/signin');
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className={className ?? styles.signOut} role={role} onClick={() => void onClick()} disabled={busy}>
        {icon}
        {busy ? 'Signing out…' : 'Sign out'}
      </button>
      {failed ? (
        <p role="alert" className={styles.signOutError}>
          Couldn&apos;t sign you out. Try again.
        </p>
      ) : null}
    </>
  );
}
