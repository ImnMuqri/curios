'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, apiFetch } from '../../../lib/api.js';
import styles from './billing.module.css';

/** The card line as plain data: this file must not import the @curios/core barrel, so the page formats it. */
export interface RenewCard {
  /** "Visa ending 4242"; null when CHIP did not say. */
  label: string | null;
  /** "RM49". */
  price: string;
  /** "14 Dec 2026". */
  paidUntil: string;
  /** The last renewal was refused: the job tries again tomorrow. */
  failed: boolean;
}

/** A 4xx carries a sentence written for the owner; anything else gets a plain one. */
function offError(failure: unknown): string {
  if (failure instanceof ApiError) return failure.message;
  return failure instanceof Error ? failure.message : 'Something failed. Try again.';
}

/**
 * What auto-renew is about to do, and the way to stop it. Turning it off asks
 * first, in place, the way the trial reset does: two buttons, nothing sent
 * until the owner says "Turn off". Refreshing is the caller's, so a test can
 * watch for it.
 *
 * Presentational half of the wrapper split.
 */
export function AutoRenewCard({
  card,
  onOff,
  refresh,
}: {
  card: RenewCard;
  onOff: () => Promise<unknown>;
  refresh: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function turnOff() {
    setError('');
    setBusy(true);
    try {
      await onOff();
      // Re-reads the Server Component, so the card line goes and the plan
      // card says "Renews only if you turn on auto-renew" again.
      refresh();
    } catch (failure) {
      setError(offError(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.renew} data-failed={card.failed || undefined}>
      <p>
        {card.failed
          ? 'Your last renewal didn’t go through. We’ll try again tomorrow.'
          : `Auto-renew is on. We’ll charge ${card.label ?? 'your card'} ${card.price} on ${card.paidUntil}.`}
      </p>
      <div className={styles.buttons}>
        {asking ? (
          <>
            <button type="button" className={styles.btn2} disabled={busy} onClick={() => void turnOff()}>
              {busy ? 'Turning off…' : 'Turn off'}
            </button>
            <button type="button" className={styles.btn2} disabled={busy} onClick={() => setAsking(false)}>
              Keep it on
            </button>
          </>
        ) : (
          <button type="button" className={styles.btn2} onClick={() => setAsking(true)}>
            Turn off auto-renew
          </button>
        )}
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Supplies the real handlers. A Server Component may not pass a function here. */
export function AutoRenew({ card }: { card: RenewCard }) {
  const router = useRouter();
  return (
    <AutoRenewCard
      card={card}
      onOff={() => apiFetch('/billing/auto-renew/off', { method: 'POST' })}
      refresh={() => router.refresh()}
    />
  );
}
