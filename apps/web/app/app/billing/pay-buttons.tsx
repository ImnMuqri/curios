'use client';

import type { BillingPlan } from '@curios/core';
import { Button, Callout } from '@curios/ui';
import { useState } from 'react';
import { ApiError, apiFetch } from '../../../lib/api.js';

export interface PayOption {
  plan: BillingPlan;
  label: string;
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
      {options.map((option) => (
        <Button
          key={option.plan}
          busy={busy === option.plan}
          disabled={busy !== null && busy !== option.plan}
          onClick={() => void pay(option.plan)}
        >
          {option.label}
        </Button>
      ))}
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
