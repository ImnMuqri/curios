'use client';

import { useState } from 'react';
import { formatRinggit } from '@curios/core/store';
import { ApiError, apiFetch } from '../../../../lib/api.js';
import type { ShopCopy } from '../../shop/copy.js';
import { payingKey, retryKey } from '../../shop/checkout/paying.js';
import { payButtonText, PayWays, useOnlineOffer, usePayChoice } from '../../shop/checkout/pay-ways.js';
import styles from './order.module.css';

const goTo = (url: string) => window.location.assign(url);

/**
 * "Try paying again" (DEVIATIONS 178): checkout's way picker with its online choices
 * only, the email for the receipt, and one button. It starts a new payment on the same
 * order (`POST /store/orders/:token/pay`), which cancels the earlier purchase first, or
 * settles it if it was paid after all. Shown once a payment failed or was tried too often,
 * and always on a shop whose only way to pay is online.
 */
export function RetryPay(props: {
  token: string;
  handle: string;
  displayName: string;
  copy: ShopCopy;
  totalCents: number;
  /** What the shop's CHIP account listed when last checked. */
  chipMethods: string[];
  /** The page offers the owner's QR or bank details too. */
  withQr: boolean;
  navigate?: (url: string) => void;
}) {
  const { copy } = props;
  const offer = useOnlineOffer(props.handle, props.chipMethods, props.totalCents);
  const pick = usePayChoice(offer, false);
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<'tooMany' | 'unavailable' | 'failed' | null>(null);
  const navigate = props.navigate ?? goTo;
  const total = formatRinggit(props.totalCents);

  // Nothing CHIP takes now: the QR beside it is the way, or, with none, the plain truth.
  if (pick.ways.length === 0 || note === 'unavailable') {
    return props.withQr ? (
      <p className={styles.rejected} role="status">
        {copy.onlineUnavailable}
      </p>
    ) : (
      <p className={styles.askPay} role="status">
        {copy.cantPayOnline(props.displayName)}
      </p>
    );
  }

  async function pay() {
    if (!pick.choice || !pick.ready || sending) return;
    setSending(true);
    setNote(null);
    let leaving = false;
    try {
      const paying = await apiFetch<{ url: string | null }>(`/store/orders/${encodeURIComponent(props.token)}/pay`, {
        method: 'POST',
        body: JSON.stringify({ ...pick.choice, email: pick.email.trim() }),
      });
      if (paying.url) {
        try {
          window.sessionStorage.setItem(payingKey(props.token), '1');
          window.sessionStorage.removeItem(retryKey(props.token));
        } catch {
          // No storage: the order page shows the order, paid, without the placed screen.
        }
        leaving = true;
        navigate(paying.url);
        return;
      }
      setNote('unavailable');
    } catch (error) {
      if (error instanceof ApiError && error.code === 'ORDER_ALREADY_PAID') {
        // An earlier try went through after all: the order page, read again, says so.
        leaving = true;
        navigate(`/${props.handle}/order/${encodeURIComponent(props.token)}`);
        return;
      }
      setNote(error instanceof ApiError && error.status === 429 ? 'tooMany' : 'failed');
    } finally {
      if (!leaving) setSending(false);
    }
  }

  return (
    <section className={styles.retry} aria-labelledby="order-retry">
      <h3 id="order-retry" className={styles.retryTitle}>
        {copy.tryPayAgain}
      </h3>
      <PayWays copy={copy} offer={offer} pick={pick} idPrefix="order-retry" />
      {note ? (
        <p className={styles.rejected} role="status">
          {note === 'tooMany' ? copy.payTooMany : copy.failed}
        </p>
      ) : null}
      <button type="button" className={styles.retryGo} disabled={!pick.ready || sending} onClick={() => void pay()}>
        {payButtonText(copy, total, pick)}
      </button>
    </section>
  );
}
