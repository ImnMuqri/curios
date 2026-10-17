'use client';

import type { BillingPlan } from '@curios/core';
import { useEffect, useRef, useState } from 'react';
import { ApiError, apiFetch } from '../../../lib/api.js';
import styles from './billing.module.css';

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
  /** Where paid-until lands after paying for this: "14 Dec", "14 Dec 2026". */
  afterShort: string;
  afterLong: string;
  /** How much of the line from today to `after` is already paid, 0 to 100. */
  paidPct: number;
}

/** Today, and paid-until when there is one, for the line over the plans. */
export interface PayTimeline {
  today: string;
  paidUntil: string | null;
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
 * Choosing how much time to add, and paying for it: the two plans as cards,
 * one Pay button, and a dialog that says what is about to happen before the
 * browser leaves for Billplz. With a paid-until date, a line above shows
 * today, paid-until and where paid-until lands after this payment.
 *
 * Presentational half of the wrapper split. Nothing is charged here: a bill is
 * raised and the browser goes to Billplz, where the owner pays or does not.
 */
export function PlanPay({
  options,
  timeline,
  onPay,
  navigate,
}: {
  options: PayOption[];
  timeline?: PayTimeline;
  onPay: (plan: BillingPlan) => Promise<{ url: string }>;
  navigate: (url: string) => void;
}) {
  const [chosen, setChosen] = useState<BillingPlan>(options[0]?.plan ?? 'MONTHLY');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const option = options.find((o) => o.plan === chosen) ?? options[0]!;
  const payButton = useRef<HTMLButtonElement>(null);
  const firstInDialog = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) firstInDialog.current?.focus();
  }, [open]);

  function close() {
    if (busy) return;
    setOpen(false);
    setError('');
    payButton.current?.focus();
  }

  async function pay() {
    setError('');
    setBusy(true);
    try {
      const { url } = await onPay(option.plan);
      // Left busy: the browser is leaving for Billplz.
      navigate(url);
    } catch (failure) {
      setError(payError(failure));
      setBusy(false);
    }
  }

  const paid = Math.max(0, Math.min(100, option.paidPct));
  // The paid-until label moves with the line, and hides where it would crowd an end.
  const untilAt = paid;
  const untilShown = timeline?.paidUntil && untilAt >= 20 && untilAt <= 80;

  return (
    <>
      {timeline ? (
        <div className={styles.tl} aria-hidden="true">
          <div className={styles.trk}>
            <span className={styles.tsegPaid} style={{ width: `${paid}%` }} />
            <span className={styles.tsegAdd} style={{ width: `${100 - paid}%` }} />
          </div>
          <div className={styles.lbls}>
            <span style={{ left: 0 }}>
              <b>Today</b>
              {timeline.today}
            </span>
            {untilShown ? (
              <span style={{ left: `${untilAt}%`, transform: untilAt > 70 ? 'translateX(-100%)' : 'translateX(-50%)' }}>
                <b>{timeline.paidUntil}</b>Paid until
              </span>
            ) : null}
            <span style={{ right: 0, textAlign: 'right' }}>
              <b className={styles.after}>{option.afterShort}</b>After this payment
            </span>
          </div>
        </div>
      ) : null}

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
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M3 6h18v13H3zM3 10h18" />
          </svg>
          Pay {option.price}
        </button>
        <p>
          FPX or card, through Billplz.
          <br />
          It adds to the time you already have.
        </p>
      </div>

      {open ? (
        <div
          className={styles.modal}
          onClick={(event) => {
            if (event.target === event.currentTarget) close();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') close();
          }}
        >
          <div className={styles.box} role="dialog" aria-modal="true" aria-labelledby="pay-title">
            {busy ? (
              <div className={styles.wait} role="status">
                <span className={styles.spin} aria-hidden="true" />
                <b id="pay-title">Opening Billplz…</b>
                <span>Your bank’s page opens next.</span>
              </div>
            ) : (
              <>
                <h2 id="pay-title">Add {option.period}</h2>
                <p>You’ll go to Billplz to pay by FPX or card, then come straight back here.</p>
                <div className={styles.line}>
                  <span>
                    Business, 1 {option.unit}
                    <small>Paid until becomes {option.afterLong}</small>
                  </span>
                  <b>{option.price}</b>
                </div>
                {error ? (
                  <p className={styles.error} role="alert">
                    {error}
                  </p>
                ) : null}
                <div className={styles.foot}>
                  <button ref={firstInDialog} type="button" className={styles.btn2} onClick={close}>
                    Cancel
                  </button>
                  <button type="button" className={styles.prim} onClick={() => void pay()}>
                    Continue to Billplz
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

/**
 * Supplies the real handlers. `page.tsx` is a Server Component and may not pass a
 * function to a Client Component, so the closure over apiFetch is built here. The
 * options arrive as plain data: this file must not import the @curios/core barrel,
 * whose node:crypto import has no place in a browser bundle.
 */
export function PayButtons({ options, timeline }: { options: PayOption[]; timeline?: PayTimeline }) {
  return (
    <PlanPay
      options={options}
      timeline={timeline}
      onPay={(plan) => apiFetch<{ url: string }>('/billing/bills', { method: 'POST', body: JSON.stringify({ plan }) })}
      navigate={(url) => window.location.assign(url)}
    />
  );
}
