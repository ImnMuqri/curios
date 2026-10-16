'use client';

import type { BillingPlan } from '@curios/core';
import { Button, Callout } from '@curios/ui';
import { useState } from 'react';
import { ApiError, apiFetch } from '../../../lib/api.js';
import styles from './billing.module.css';

export interface PayOption {
  plan: BillingPlan;
  /** The button's words, which say exactly what happens: "Pay RM49 for a month". */
  label: string;
  /** The card around the button, when there is one: "Monthly", "RM49", "a month". */
  name?: string;
  price?: string;
  per?: string;
  note?: string;
  /** Drawn in cobalt, as the landing page draws its Business plan. */
  featured?: boolean;
}

/**
 * The API replaces every 5xx message with a generic sentence and keeps only an
 * allow-listed code, so a Billplz outage arrives as BILLPLZ_UNAVAILABLE and nothing
 * else. Anything below 500 carries a message written for the owner, used as it is.
 */
export function payError(failure: unknown): string {
  if (failure instanceof ApiError && failure.code === 'BILLPLZ_UNAVAILABLE') {
    return 'Billplz is not answering right now. Try again in a few minutes.';
  }
  // Only ever seen in development, where billing runs switched off without Billplz settings.
  if (failure instanceof ApiError && failure.code === 'BILLING_NOT_CONFIGURED') {
    return 'Payments are switched off here: no Billplz settings in this environment.';
  }
  return failure instanceof Error ? failure.message : 'Something failed. Try again.';
}

/**
 * Presentational half of the wrapper split, the shape of AddPasswordForm. Both buttons
 * hold while either is starting, because a double press would raise two bills.
 */
export function PayButtonsForm({
  options,
  onPay,
  navigate,
}: {
  options: PayOption[];
  onPay: (plan: BillingPlan) => Promise<{ url: string }>;
  navigate: (url: string) => void;
}) {
  const [busy, setBusy] = useState<BillingPlan | null>(null);
  const [error, setError] = useState('');

  async function pay(plan: BillingPlan) {
    setError('');
    setBusy(plan);
    try {
      const { url } = await onPay(plan);
      // Left busy: the browser is leaving for Billplz.
      navigate(url);
    } catch (failure) {
      setError(payError(failure));
      setBusy(null);
    }
  }

  return (
    <div>
      <div className={styles.plans}>
        {options.map((option) => (
          <div key={option.plan} className={styles.plan} data-featured={option.featured || undefined}>
            {option.name ? <p className={styles.planName}>{option.name}</p> : null}
            {option.price ? (
              <p className={styles.planPrice}>
                {option.price}
                {option.per ? <span> {option.per}</span> : null}
              </p>
            ) : null}
            {option.note ? <p className={styles.planNote}>{option.note}</p> : null}
            <Button
              busy={busy === option.plan}
              disabled={busy !== null && busy !== option.plan}
              onClick={() => void pay(option.plan)}
            >
              {option.label}
            </Button>
          </div>
        ))}
      </div>
      {error ? <Callout tone="error">{error}</Callout> : null}
    </div>
  );
}

/**
 * Supplies the real handlers. `page.tsx` is a Server Component and may not pass a
 * function to a Client Component, so the closure over apiFetch is built here. The
 * options arrive as plain data: this file must not import the @curios/core barrel,
 * whose node:crypto import has no place in a browser bundle.
 */
export function PayButtons({ options }: { options: PayOption[] }) {
  return (
    <PayButtonsForm
      options={options}
      onPay={(plan) =>
        apiFetch<{ url: string }>('/billing/bills', { method: 'POST', body: JSON.stringify({ plan }) })
      }
      navigate={(url) => window.location.assign(url)}
    />
  );
}
