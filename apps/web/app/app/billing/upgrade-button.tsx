'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiFetch } from '../../../lib/api.js';
import styles from './billing.module.css';

/**
 * Personal to business, in two steps. One click must not do it: the switch is
 * one-way -- nothing leads back -- and it ends the privacy default, so the
 * owner sees both facts before confirming.
 *
 * Presentational half of the wrapper split, the shape of `ResetTrialForm`.
 */
export function UpgradeForm({
  onUpgrade,
  refresh,
}: {
  onUpgrade: () => Promise<unknown>;
  refresh: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function upgrade() {
    setError('');
    setBusy(true);
    try {
      await onUpgrade();
      // Re-reads the Server Component: the plan summary, the pay buttons and
      // this section all change with the mode.
      refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Something failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <div className={styles.buttons}>
        <button type="button" className={styles.prim} onClick={() => setConfirming(true)}>
          Make this a business page
        </button>
      </div>
    );
  }

  return (
    <div className={styles.buttons}>
      <p>Your page will appear in search results, and you cannot switch it back to personal.</p>
      <button type="button" className={styles.prim} disabled={busy} onClick={() => void upgrade()}>
        Yes, switch. This can&apos;t be undone
      </button>
      <button type="button" className={styles.btn2} disabled={busy} onClick={() => setConfirming(false)}>
        Keep it personal
      </button>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Supplies the real handlers. A Server Component may not pass a function here. */
export function UpgradeToBusiness() {
  const router = useRouter();
  return (
    <UpgradeForm
      onUpgrade={() => apiFetch('/pages/upgrade', { method: 'POST' })}
      refresh={() => router.refresh()}
    />
  );
}
