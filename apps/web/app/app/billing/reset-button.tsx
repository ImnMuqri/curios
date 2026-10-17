'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, apiFetch } from '../../../lib/api.js';
import styles from './billing.module.css';

/**
 * The API's 409 already says exactly what happened and what to do instead, and
 * it is a 4xx, so `errorsPlugin` leaves the message alone. Anything else falls
 * back to a sentence rather than showing an owner a stack-shaped string.
 */
export function resetError(failure: unknown): string {
  if (failure instanceof ApiError) return failure.message;
  return failure instanceof Error ? failure.message : 'Something failed. Try again.';
}

/**
 * Presentational half of the wrapper split, the shape of `PlanPay` and
 * `AddPasswordForm`. Refreshing is the caller's, so a test can watch for it.
 */
export function ResetTrialForm({
  onReset,
  refresh,
}: {
  onReset: () => Promise<unknown>;
  refresh: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function reset() {
    setError('');
    setBusy(true);
    try {
      await onReset();
      // Re-reads the Server Component, so the count, the plan summary and this
      // button all agree -- the same reason the questions screen refreshes.
      refresh();
    } catch (failure) {
      setError(resetError(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.buttons}>
      <button type="button" className={styles.btn2} disabled={busy} onClick={() => void reset()}>
        {busy ? 'Resetting…' : 'Reset my free trial'}
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
export function ResetTrial() {
  const router = useRouter();
  return (
    <ResetTrialForm
      onReset={() => apiFetch('/billing/trial-reset', { method: 'POST' })}
      refresh={() => router.refresh()}
    />
  );
}
