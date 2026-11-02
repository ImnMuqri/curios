'use client';

import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { FAIL_BANK_SAID, type FailReason } from '@curios/core/chip-status';
import { formatRinggit } from '@curios/core/store';
import { ApiError, apiFetch } from '../../../../lib/api.js';
import { defaultStorageKey, writeBasket, type BasketLine } from '../../shop/basket.js';
import type { ShopCopy } from '../../shop/copy.js';
import { RetryPay } from './retry-pay.js';
import checkout from '../../shop/checkout/checkout.module.css';
import styles from './order.module.css';

const goTo = (url: string) => window.location.assign(url);

/** `**bold**` in a copy string, drawn as <b>: the words the board makes bold. */
function marked(text: string): ReactNode {
  return text.split('**').map((part, i) => (i % 2 === 1 ? <b key={i}>{part}</b> : <Fragment key={i}>{part}</Fragment>));
}

/**
 * The full page when the customer comes back from CHIP and the payment did not go
 * through (Public board, `payfail`): nothing was taken, the order is held, and the two
 * ways on. "Pay again" opens RetryPay (a new purchase on this order); "Pay another way"
 * gives the order's lines back to the basket, cancels the order and goes to checkout.
 */
export function PayFailed(props: {
  token: string;
  handle: string;
  displayName: string;
  copy: ShopCopy;
  code: string;
  lines: { itemName: string; optionLabel: string | null; unitPriceCents: number; quantity: number }[];
  totalCents: number;
  reason: FailReason;
  /** How it was tried, e.g. `FPX · Maybank2u`; null when CHIP did not say. */
  method: string | null;
  /** What the shop's CHIP account takes; null hides "Pay again", with nothing to pay by. */
  chipMethods: string[] | null;
  navigate?: (url: string) => void;
}) {
  const { copy } = props;
  const navigate = props.navigate ?? goTo;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const [again, setAgain] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [note, setNote] = useState<'open' | 'tooMany' | 'failed' | null>(null);
  const total = formatRinggit(props.totalCents);

  async function payAnotherWay() {
    if (leaving) return;
    setLeaving(true);
    setNote(null);
    let going = false;
    try {
      const back = await apiFetch<{ lines: { itemId: string; optionId: string | null; quantity: number; sessionId: string | null }[] }>(
        `/store/orders/${encodeURIComponent(props.token)}/pay-another-way`,
        { method: 'POST' },
      );
      // Lines whose item or option is gone are left out by the API: checkout prices what is still there.
      const lines: BasketLine[] = back.lines.map((l) => ({ itemId: l.itemId, optionId: l.optionId, quantity: l.quantity, sessionId: l.sessionId }));
      writeBasket(defaultStorageKey(props.handle), lines);
      going = true;
      navigate(`/${props.handle}/shop/checkout`);
    } catch (error) {
      if (error instanceof ApiError && (error.code === 'ORDER_ALREADY_PAID' || error.code === 'ORDER_RECEIPT_SENT')) {
        // CHIP took the money after all, or a receipt came in: the order page, read again, says so.
        going = true;
        navigate(`/${props.handle}/order/${encodeURIComponent(props.token)}`);
        return;
      }
      setNote(error instanceof ApiError && error.code === 'ORDER_PAYMENT_OPEN' ? 'open' : error instanceof ApiError && error.status === 429 ? 'tooMany' : 'failed');
    } finally {
      if (!going) setLeaving(false);
    }
  }

  return (
    <div className={`${checkout.placed} ${styles.pf}`}>
      <span className={styles.pfIcon} aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M7 7l10 10M17 7L7 17" />
        </svg>
      </span>
      <h1 ref={heading} className={checkout.placedTitle} tabIndex={-1}>
        {copy.payFailedTitle}
      </h1>
      <p className={checkout.placedSub}>{marked(copy.payFailedHeld(props.displayName))}</p>

      <div className={checkout.codebox}>
        <small>{copy.yourCode}</small>
        <div className={styles.pfCode} role="img" aria-label={copy.codeLabel(props.code)}>
          {props.code.split('').map((ch, i) => (
            <span key={i} data-tone="failed">
              {ch}
            </span>
          ))}
        </div>
        <div className={styles.pfLines}>
          {props.lines.map((line, i) => (
            <div key={i}>
              <span>
                {line.quantity}× {line.itemName}
                {line.optionLabel ? ` · ${line.optionLabel}` : ''}
              </span>
              <b>{formatRinggit(line.unitPriceCents * line.quantity)}</b>
            </div>
          ))}
          <div className={styles.pfTotal}>
            <span>{copy.total}</span>
            <b>{total}</b>
          </div>
        </div>
      </div>

      {props.chipMethods && !again ? (
        <button type="button" className={checkout.pay} onClick={() => setAgain(true)}>
          {copy.payAgain(total)}
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      ) : null}
      {again && props.chipMethods ? (
        <div className={styles.pfRetry}>
          <RetryPay token={props.token} handle={props.handle} displayName={props.displayName} copy={copy} totalCents={props.totalCents} chipMethods={props.chipMethods} withQr={false} navigate={props.navigate} />
        </div>
      ) : null}
      <button type="button" className={styles.pfAlt} disabled={leaving} onClick={() => void payAnotherWay()}>
        {copy.payAnotherWay}
      </button>
      {note ? (
        <p className={styles.rejected} role="status">
          {note === 'open' ? copy.payStillOpen : note === 'tooMany' ? copy.payTooMany : copy.failed}
        </p>
      ) : null}
      <p className={styles.pfSmall}>{copy.triedWith(props.method, FAIL_BANK_SAID[props.reason])}</p>
    </div>
  );
}
