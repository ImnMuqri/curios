'use client';

import type { BillingPlan } from '@curios/core';
import { useEffect, useId, useRef, useState } from 'react';
import { ApiError, apiFetch } from '../../../lib/api.js';
import { Dialog } from '../_ui/dialog.js';
import { SheetAction } from '../_ui/side-sheet.js';
import { usePayDialog } from './pay-context.js';
import styles from './billing.module.css';
import { Callout } from '@curios/ui';

export interface PayOption {
  plan: BillingPlan;
  /** "Monthly", "RM49", "One month at a time". */
  name: string;
  price: string;
  note: string;
  /** "a month": the dialog's "Add a month". */
  period: string;
  /** "month": "Business, 1 month". */
  unit: string;
  /** "2 months free", on the yearly one. */
  save?: string;
  /** Where paid-until lands after paying for this: "2 January 2027". The dialog says it, so the plan card does not draw it. */
  afterLong: string;
}

/**
 * The API replaces every 5xx message with a generic sentence and keeps only an
 * allow-listed code, so a CHIP outage arrives as CHIP_UNAVAILABLE and nothing
 * else. Anything below 500 carries a message written for the owner, used as it is.
 */
export function payError(failure: unknown): string {
  if (failure instanceof ApiError && failure.code === 'CHIP_UNAVAILABLE') {
    return 'CHIP is not answering right now. Try again in a few minutes.';
  }
  // Only ever seen in development, where billing runs switched off without CHIP settings.
  if (failure instanceof ApiError && failure.code === 'BILLING_NOT_CONFIGURED') {
    return 'Payments are switched off here: no CHIP settings in this environment.';
  }
  return failure instanceof Error ? failure.message : 'Something failed. Try again.';
}

/**
 * Choosing how much time to add, and paying for it: the two plans as rows, one
 * Pay button, and a dialog that says what is about to happen (and where paid-until
 * lands) before the browser leaves for CHIP.
 *
 * The dialog holds a box that asks to keep the card for renewing. Ticked, CHIP is
 * sent to take a card only, since a card is the one thing that can be charged
 * again; the API is told with `autoRenew`, and `?card=off` says so if CHIP kept
 * none. It starts unticked each time the dialog opens: consent is given for the
 * payment in front of the owner, never carried over from the last one.
 *
 * Presentational half of the wrapper split. Nothing is charged here: a purchase
 * is opened and the browser goes to CHIP, where the owner pays or does not.
 */
export function PlanPay({
  options,
  initialOpen = false,
  onPay,
  navigate,
}: {
  options: PayOption[];
  /** The dialog is already open on arrival (an old "Try again" link lands here). */
  initialOpen?: boolean;
  onPay: (plan: BillingPlan, autoRenew: boolean) => Promise<{ url: string }>;
  navigate: (url: string) => void;
}) {
  const [chosen, setChosen] = useState<BillingPlan>(options[0]?.plan ?? 'MONTHLY');
  const [autoRenew, setAutoRenew] = useState(false);
  // Shared with "Pay another way" and the payment toast when Billing provides it.
  const shared = usePayDialog();
  const [localOpen, setLocalOpen] = useState(initialOpen);
  const open = shared ? shared.open : localOpen;
  const setOpen = shared ? shared.setOpen : setLocalOpen;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const option = options.find((o) => o.plan === chosen) ?? options[0]!;
  const payButton = useRef<HTMLButtonElement>(null);
  const hintId = useId();
  const boxId = useId();

  // Back from CHIP by the browser's Back button, the page can come out of the back-forward cache exactly
  // as it was left: still "Opening CHIP…". Nothing is opening any more.
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) setBusy(false);
    };
    window.addEventListener('pageshow', restored);
    return () => window.removeEventListener('pageshow', restored);
  }, []);

  function close() {
    if (busy) return;
    setOpen(false);
    setError('');
    setAutoRenew(false);
  }

  async function pay() {
    setError('');
    setBusy(true);
    try {
      const { url } = await onPay(option.plan, autoRenew);
      // Left busy: the browser is leaving for CHIP.
      navigate(url);
    } catch (failure) {
      setError(payError(failure));
      setBusy(false);
    }
  }

  return (
    <>
      <div className={styles.pick} role="radiogroup" aria-label="How much time to add">
        {options.map((o) => (
          <button key={o.plan} type="button" role="radio" aria-checked={o.plan === chosen} className={styles.opt} onClick={() => setChosen(o.plan)}>
            <span className={styles.on} aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            </span>
            <small>{o.name}</small>
            <b>{o.price}</b>
            <span>{o.note}</span>
            {o.save ? <em>{o.save}</em> : null}
          </button>
        ))}
      </div>

      <div className={styles.pay}>
        <button ref={payButton} type="button" className={styles.go} onClick={() => setOpen(true)}>
          Pay {option.price}
        </button>
        <p>FPX, e-wallet or card, through CHIP. It adds to the time you already have.</p>
      </div>

      <Dialog
        open={open}
        onClose={close}
        title={`Add ${option.period}`}
        description={`You’ll go to CHIP to pay by ${autoRenew ? 'card' : 'FPX, card or e-wallet'}, then come straight back here.`}
        returnFocusTo={payButton}
      >
        {busy ? (
          <div className={styles.wait} role="status">
            <span className={styles.spin} aria-hidden="true" />
            <b>Opening CHIP…</b>
            <span>CHIP’s payment page opens next.</span>
          </div>
        ) : (
          <>
            <div className={styles.line}>
              <span>
                <b>Business, 1 {option.unit}</b>
                <small>Paid until becomes {option.afterLong}</small>
              </span>
              <b className={styles.price}>{option.price}</b>
            </div>
            <div className={styles.tick}>
              <input id={boxId} type="checkbox" checked={autoRenew} onChange={(event) => setAutoRenew(event.target.checked)} aria-describedby={hintId} />
              <div>
                <label htmlFor={boxId}>Renew automatically by card</label>
                <small id={hintId}>We’ll charge your card when this period ends. Turn it off any time.</small>
              </div>
            </div>
            {error ? (
              <Callout tone="error">
                {error}
              </Callout>
            ) : null}
            <SheetAction className={styles.continue} onClick={() => void pay()}>
              Continue to CHIP
            </SheetAction>
            <p className={styles.hint}>CHIP’s payment page opens next.</p>
          </>
        )}
      </Dialog>
    </>
  );
}

/**
 * Supplies the real handlers. `page.tsx` is a Server Component and may not pass a
 * function to a Client Component, so the closure over apiFetch is built here. The
 * options arrive as plain data: this file must not import the @curios/core barrel,
 * whose node:crypto import has no place in a browser bundle.
 */
export function PayButtons({ options, initialOpen }: { options: PayOption[]; initialOpen?: boolean }) {
  return (
    <PlanPay
      options={options}
      initialOpen={initialOpen}
      onPay={(plan, autoRenew) => apiFetch<{ url: string }>('/billing/purchases', { method: 'POST', body: JSON.stringify({ plan, autoRenew }) })}
      navigate={(url) => window.location.assign(url)}
    />
  );
}
