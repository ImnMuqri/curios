'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useState, type MouseEvent } from 'react';
import { LayerPortal } from '../_ui/overlay-context.js';
import { PeekBody } from '../_ui/peek.js';
import { LAYER_STOP } from '../_ui/use-modal.js';
import { usePayDialog } from './pay-context.js';
import type { PaymentNotice } from './billing-copy.js';
import styles from './payment-toast.module.css';

/** How often a payment that is still being confirmed is looked at again, and how many times. */
export const POLL_MS = 3000;
export const POLL_TRIES = 20;
/** A paid toast goes by itself; a failed or unfinished one waits to be dismissed (it has a button worth reaching). */
export const PAID_MS = 8000;
/** How long the region is in the page before its first words. */
export const SETTLE_MS = 50;

/** Peek's face in the pill: happy for a payment, sad for one that did not go through. */
function ToastPeek({ ok }: { ok: boolean }) {
  const clip = `ptpk${useId().replace(/[^\w-]/g, '')}`;
  return (
    <span className={styles.face} aria-hidden="true">
      <svg viewBox="14 24 132 124" focusable="false">
        <defs>
          <clipPath id={clip}>
            <ellipse cx="80" cy="84" rx="54" ry="49" />
          </clipPath>
        </defs>
        <PeekBody clipId={clip} look={{ x: 67, y: 85 }} mouth={ok ? 'happy' : 'frown'} />
      </svg>
    </span>
  );
}

/**
 * What Billing says on coming back from CHIP, the board's `.ptoast`: Peek, a title, a line, and one
 * action ("See receipt" after a payment, "Try again" after one that failed, when online payments are on).
 * It is a polite live region: the region is in the page first and its words are put in a moment later, because
 * a region that appears together with its text is often not read at all.
 *
 * `notice` comes from the server, from the payment's own record (paymentNotice), so "Paid" is never
 * drawn for a payment the server has not granted. While the record is not settled the toast says it
 * is checking and asks the server again every few seconds (router.refresh); when it settles the same
 * toast turns into Paid or Didn't go through. The query string that named the payment is then taken
 * off the address, so a refresh does not play it again; what is on screen stays until it is
 * dismissed (or, for a paid one, a few seconds).
 *
 * "See receipt" goes to the Payments table: CHIP emails the receipt itself, and the table is where
 * the payment shows. "Try again" opens the pay dialog.
 */
export function PaymentToast({ notice, canPay }: { notice: PaymentNotice | null; canPay: boolean }) {
  const router = useRouter();
  const pay = usePayDialog();
  const [shown, setShown] = useState<PaymentNotice | null>(null);
  const [gaveUp, setGaveUp] = useState(false);
  const key = notice ? JSON.stringify(notice) : '';
  const checking = notice?.kind === 'checking';
  const settled = notice !== null && notice.kind !== 'checking';

  // A new answer from the server replaces what is showing; no answer (the address was cleaned) keeps it.
  // Put in after a tick, so the live region is already in the page when its words arrive.
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setShown(notice), SETTLE_MS);
    return () => clearTimeout(id);
    // Keyed on the answer's identity only: `notice` is a fresh object each render.
  }, [key]);

  // Settled: take the payment off the address, so a refresh is quiet.
  useEffect(() => {
    if (settled) router.replace('/app/billing', { scroll: false });
  }, [settled, router]);

  // Not settled: ask again, for a minute or so.
  useEffect(() => {
    if (!checking) return;
    let n = 0;
    const id = setInterval(() => {
      n += 1;
      if (n > POLL_TRIES) {
        clearInterval(id);
        setGaveUp(true);
        router.replace('/app/billing', { scroll: false });
        return;
      }
      router.refresh();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [checking, router]);

  useEffect(() => {
    if (shown?.kind !== 'paid') return;
    const id = setTimeout(() => setShown(null), PAID_MS);
    return () => clearTimeout(id);
  }, [shown]);

  function dismiss() {
    setShown(null);
    if (notice) router.replace('/app/billing', { scroll: false });
  }

  function receipt(event: MouseEvent) {
    event.preventDefault();
    dismiss();
    document.getElementById('payments')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function again() {
    dismiss();
    pay?.setOpen(true);
  }

  const lost = shown?.kind === 'checking' && gaveUp;
  return (
    <LayerPortal>
      <div className={styles.slot} role="status" aria-live="polite">
        {shown ? (
          <div className={styles.ptoast} data-tone={shown.kind} data-note={(shown.kind === 'paid' && shown.note) || undefined} data-lost={lost || undefined}>
            {lost ? (
              <span className={styles.face} aria-hidden="true">
                i
              </span>
            ) : shown.kind === 'checking' ? (
              <span className={styles.spin} aria-hidden="true" />
            ) : (
              <ToastPeek ok={shown.kind === 'paid'} />
            )}
            <span className={styles.words}>
              <b>
                {shown.kind === 'failed' ? (
                  <>
                    <span className={styles.long}>{shown.title}</span>
                    <span className={styles.short}>{shown.short}</span>
                  </>
                ) : lost ? (
                  'Still checking your payment'
                ) : (
                  shown.title
                )}
              </b>
              <small>{lost ? 'It will show under Payments once CHIP confirms.' : shown.sub}</small>
              {shown.kind === 'paid' && shown.note ? <em>{shown.note}</em> : null}
            </span>
            {shown.kind === 'paid' ? (
              <a href="#payments" className={styles.act} onClick={receipt}>
                See receipt
              </a>
            ) : shown.kind === 'failed' && pay && canPay ? (
              <button type="button" className={styles.act} onClick={again}>
                Try again
              </button>
            ) : null}
            <button type="button" className={styles.x} aria-label="Dismiss" {...{ [LAYER_STOP]: '' }} onClick={dismiss}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 7l10 10M17 7L7 17" />
              </svg>
            </button>
          </div>
        ) : null}
      </div>
    </LayerPortal>
  );
}
