'use client';

import { useEffect, useState } from 'react';
import { customerSteps, isRiderDelivery, orderView, type OrderStatus } from '@curios/core/orders';
import { formatRinggit } from '@curios/core/store';
import { shopCopy, type ShopCopy } from '../../shop/copy.js';
import { whatsappOrderUrl } from '../../shop/basket.js';
import { payingKey } from '../../shop/checkout/paying.js';
import { Placed } from '../../shop/checkout/placed.js';
import { apiFetch } from '../../../../lib/api.js';
import { hasBank, PayBox, useCopied } from './pay-box.js';
import { ReceiptUpload } from './receipt-upload.js';
import checkout from '../../shop/checkout/checkout.module.css';
import styles from './order.module.css';

export interface OrderViewProps {
  token: string;
  handle: string;
  displayName: string;
  language: string;
  /** What the customer may see of their order: no name, phone, address or note is sent to the browser. */
  order: {
    number: number;
    code: string;
    method: 'PICKUP' | 'DELIVERY';
    day: string;
    itemsCents: number;
    deliveryCents: number;
    totalCents: number;
    status: OrderStatus;
    receiptType: string | null;
    /** ISO times, or null. */
    receiptUploadedAt: string | null;
    receiptRejectedAt: string | null;
    paidAt: string | null;
    refundedAt: string | null;
    /** How it was paid, and for CHIP, how CHIP says and its reference. */
    paidVia?: 'RECEIPT' | 'MANUAL' | 'CHIP' | null;
    paidMethodLabel?: string | null;
    paidRef?: string | null;
    /** Placed, with a CHIP purchase started for it: the page asks the API how it went. */
    chipPending?: boolean;
    lines: { itemName: string; optionLabel: string | null; unitPriceCents: number; quantity: number }[];
  };
  qrUrl: string | null;
  receiptUrl: string | null;
  bank: { name: string | null; accountName: string | null; accountNumber: string | null };
  /** The shop's WhatsApp number; no button without one. */
  whatsapp: string | null;
  /** The server's clock when it rendered (ISO). */
  now: string;
}

type Tone = 'wait' | 'check' | 'ok' | 'stop' | 'quiet';

/** What GET /store/orders/:token/pay-status answers. */
type PayStatus =
  | { state: 'paid'; paidAt: string | null; paidMethodLabel: string | null; paidRef: string | null }
  | { state: 'pending' | 'failed' | 'none' | 'unknown' };

/**
 * Quick checks while the customer has just come back, then slower ones for about ten
 * minutes: 35 checks a load, well inside the API's per-order budget.
 */
const QUICK_CHECKS = 5;
const QUICK_MS = 2000;
const SLOW_CHECKS = 30;
const SLOW_MS = 20_000;

/**
 * A payment in flight on CHIP: asks the API (which asks CHIP with the owner's key and
 * settles the order the way the callback does) until it is paid, has failed, or the
 * checks run out. "checking" first, "waiting" once the quick checks are spent or the API
 * cannot ask CHIP at all ("unknown"), when the page also offers the QR.
 */
function usePaymentCheck(token: string, pending: boolean) {
  const [check, setCheck] = useState<'checking' | 'waiting' | 'failed' | null>(pending ? 'checking' : null);
  const [paid, setPaid] = useState<Extract<PayStatus, { state: 'paid' }> | null>(null);
  useEffect(() => {
    if (!pending) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tries = 0;
    const poll = async () => {
      tries += 1;
      try {
        const status = await apiFetch<PayStatus>(`/store/orders/${encodeURIComponent(token)}/pay-status`);
        if (stopped) return;
        if (status.state === 'paid') {
          setPaid(status);
          setCheck(null);
          return;
        }
        if (status.state === 'failed' || status.state === 'none') {
          setCheck(status.state === 'failed' ? 'failed' : null);
          return;
        }
        if (status.state === 'unknown') setCheck('waiting');
      } catch {
        // Asked again below: a hiccup is not an answer.
      }
      if (stopped) return;
      if (tries >= QUICK_CHECKS) setCheck('waiting');
      if (tries >= QUICK_CHECKS + SLOW_CHECKS) return;
      timer = setTimeout(() => void poll(), tries < QUICK_CHECKS ? QUICK_MS : SLOW_MS);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [token, pending]);
  return { check, paid };
}

const date = (iso: string | null) => (iso ? new Date(iso) : null);

const EXTENSION: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };

/** The pill's words and colour, from the Orders board's view and the customer's steps. */
function pill(view: ReturnType<typeof orderView>, ready: boolean, name: string, copy: ShopCopy): { text: string; tone: Tone } {
  switch (view) {
    case 'awaitingPayment':
      return { text: copy.statusWaiting, tone: 'wait' };
    case 'toCheck':
      return { text: copy.statusChecking(name), tone: 'check' };
    case 'paid':
      return ready ? { text: copy.statusReady, tone: 'ok' } : { text: copy.statusPaid(name), tone: 'ok' };
    case 'completed':
      return { text: copy.statusDone, tone: 'ok' };
    case 'refunded':
      return { text: copy.statusRefunded, tone: 'quiet' };
    case 'refundOwed':
      return { text: copy.statusRefundDue, tone: 'stop' };
    case 'cancelled':
      return { text: copy.statusCancelled, tone: 'stop' };
  }
}

/**
 * The customer's order link (Public board, `order`): where it is, how to pay,
 * and the receipt. Every name and number is this order's and this shop's.
 */
export function OrderView(props: OrderViewProps) {
  const { displayName: name } = props;
  const copy = shopCopy(props.language);
  const [codeCopied, copyCode] = useCopied();
  const { check, paid: confirmed } = usePaymentCheck(props.token, props.order.status === 'PLACED' && props.order.chipPending === true);
  // Paid while the customer was at CHIP (or, by the callback, before this page rendered).
  const order: OrderViewProps['order'] = confirmed
    ? { ...props.order, status: 'PAID', paidVia: 'CHIP', paidAt: confirmed.paidAt, paidMethodLabel: confirmed.paidMethodLabel, paidRef: confirmed.paidRef, chipPending: false }
    : props.order;
  const paidOnline = order.paidVia === 'CHIP' && (order.status === 'PAID' || order.status === 'COMPLETED');

  // Back from paying online (checkout marked it): the board's "Paid. Order placed", once.
  const [celebrate, setCelebrate] = useState(false);
  useEffect(() => {
    if (!paidOnline) return;
    try {
      if (window.sessionStorage.getItem(payingKey(props.token)) === '1') setCelebrate(true);
    } catch {
      // No storage: straight to the order.
    }
  }, [paidOnline, props.token]);
  function seeOrder() {
    try {
      window.sessionStorage.removeItem(payingKey(props.token));
    } catch {
      // Nothing to forget.
    }
    setCelebrate(false);
  }

  const facts = {
    status: order.status,
    receiptUploadedAt: date(order.receiptUploadedAt),
    paidAt: date(order.paidAt),
    refundedAt: date(order.refundedAt),
  };
  const view = orderView(facts);
  const steps = customerSteps({ status: order.status, paidAt: facts.paidAt, day: order.day }, new Date(props.now));
  const status = pill(view, steps.ready, name, copy);
  // While a payment is being checked the QR stays away, so nobody pays twice; once the wait
  // drags on, it comes back under the wait, with a word against paying twice.
  const inFlight = check === 'checking' || check === 'waiting';
  const needPay = (view === 'awaitingPayment' || view === 'toCheck') && check !== 'checking';
  const stopped = order.status === 'CANCELLED';
  const total = formatRinggit(order.totalCents);

  const stepList = [
    { label: copy.steps.placed, done: steps.placed },
    { label: copy.steps.paid, done: steps.paid },
    { label: copy.steps.ready, done: steps.ready },
    { label: copy.steps.done, done: steps.done },
  ];
  // The step being waited on: the first one not yet lit.
  const nowAt = stepList.findIndex((step) => !step.done);

  const receiptName = `receipt-${order.number}.${EXTENSION[order.receiptType ?? ''] ?? 'jpg'}`;

  if (celebrate) {
    return (
      <main className={`${checkout.column} ${checkout.placedColumn}`}>
        <Placed
          handle={props.handle}
          displayName={name}
          copy={copy}
          code={order.code}
          token={props.token}
          totalCents={order.totalCents}
          onSeeOrder={seeOrder}
        />
      </main>
    );
  }

  return (
    <main className={checkout.column}>
      <div className={checkout.top}>
        <span>{name}</span>
        <span className={styles.bookmark}>{copy.bookmark}</span>
      </div>

      <div className={styles.titleRow}>
        <h1 className={checkout.title}>{copy.orderTitle(order.number)}</h1>
        <span className={styles.pill} data-tone={status.tone}>
          <i aria-hidden="true" />
          {status.text}
        </span>
      </div>

      <div className={`${checkout.sheet} ${styles.sheet}`} data-testid="sheet">
      <p className={styles.code}>
        {copy.orderCode} <b>{order.code}</b>
        <button type="button" className={styles.textButton} onClick={() => copyCode(order.code)}>
          {codeCopied ? copy.copied : copy.copyCode}
        </button>
      </p>

      {stopped ? null : (
        <ol className={styles.steps} aria-label={copy.orderProgress}>
          {stepList.map((step, i) => {
            const state = step.done ? 'done' : i === nowAt ? 'now' : undefined;
            return (
              <li key={step.label} className={styles.step} data-state={state} aria-current={state === 'now' ? 'step' : undefined}>
                <i aria-hidden="true">
                  {step.done ? (
                    <svg viewBox="0 0 24 24">
                      <path d="M5 12.5l4.5 4.5L19 7.5" />
                    </svg>
                  ) : null}
                </i>
                <span>
                  {step.label}
                  {/* The tick says it to the eye; this says it to a screen reader. */}
                  {step.done ? <span className={styles.srOnly}>{`, ${copy.stepDone}`}</span> : null}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {inFlight ? (
        <section className={checkout.section}>
          <div className={`${styles.upload} ${styles.sent} ${styles.checking}`} role="status">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2" />
            </svg>
            <span>
              <b>{copy.checkingPayment}</b>
              {check === 'waiting' ? <span>{copy.stillWaiting}</span> : null}
              {check === 'waiting' ? <span>{copy.dontPayAgain(name)}</span> : null}
            </span>
          </div>
        </section>
      ) : null}

      {paidOnline ? (
        <section className={checkout.section}>
          <div className={`${styles.upload} ${styles.sent}`}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
            <span>
              <b>{copy.paidBy(total, copy.methodLabel(order.paidMethodLabel ?? 'CHIP'))}</b>
              {order.paidAt ? (
                <span>{order.paidRef ? copy.paidWhen(copy.paidTime(order.paidAt), order.paidRef) : copy.paidTime(order.paidAt)}</span>
              ) : null}
            </span>
          </div>
        </section>
      ) : null}

      {needPay ? (
        <section className={checkout.section} aria-labelledby="order-pay">
          <div className={checkout.head}>
            <h2 id="order-pay">{copy.payTitle(total)}</h2>
            <span>{copy.payTo(name)}</span>
          </div>
          {check === 'failed' ? (
            <p className={styles.rejected} role="status">
              {copy.onlineFailed}
            </p>
          ) : null}
          {order.receiptRejectedAt && view === 'awaitingPayment' ? (
            <p className={styles.rejected} role="status">
              {copy.notReceived(name)}
            </p>
          ) : null}
          {props.qrUrl || hasBank(props.bank) ? (
            <PayBox
              name={name}
              qrUrl={props.qrUrl}
              bank={props.bank}
              copy={copy}
              saveHref={`/${props.handle}/order/${encodeURIComponent(props.token)}/qr`}
            />
          ) : (
            <p className={styles.askPay}>{copy.askHowToPay(name)}</p>
          )}
          {view === 'toCheck' ? (
            <div className={`${styles.upload} ${styles.sent}`}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
              <span>
                <b>
                  {props.receiptUrl ? (
                    <a href={props.receiptUrl} target="_blank" rel="noopener noreferrer">
                      {receiptName}
                    </a>
                  ) : (
                    receiptName
                  )}{' '}
                  {copy.receiptSent}
                </b>
                <span>{copy.checksIt(name)}</span>
              </span>
            </div>
          ) : null}
          {view === 'toCheck' ? (
            // Until it is marked paid, a second receipt replaces the first.
            <ReceiptUpload token={props.token} displayName={name} copy={copy} replace />
          ) : (
            <ReceiptUpload token={props.token} displayName={name} copy={copy} />
          )}
        </section>
      ) : null}

      <section className={checkout.section} aria-labelledby="order-lines">
        <div className={checkout.head}>
          <h2 id="order-lines">{copy.yourOrder}</h2>
          <span>
            {order.method === 'PICKUP' ? copy.pickupLabel : copy.deliveryLabel} · {copy.dayLong(order.day)}
            {isRiderDelivery(order) ? ` · ${copy.riderPaidSeparately}` : null}
          </span>
        </div>
        <ul className={styles.lines}>
          {order.lines.map((line, i) => (
            <li key={i} className={styles.line}>
              <span>
                <b>
                  {line.quantity}× {line.itemName}
                </b>
                {line.optionLabel ? <span>{line.optionLabel}</span> : null}
              </span>
              <span>{formatRinggit(line.unitPriceCents * line.quantity)}</span>
            </li>
          ))}
          {order.deliveryCents > 0 ? (
            <li className={styles.line}>
              <span>
                <b>{copy.deliveryLabel}</b>
              </span>
              <span>{formatRinggit(order.deliveryCents)}</span>
            </li>
          ) : null}
        </ul>
        <div className={styles.total}>
          <span>{copy.total}</span>
          <span>{total}</span>
        </div>
      </section>

      {props.whatsapp ? (
        <a className={styles.whatsapp} href={whatsappOrderUrl(props.whatsapp, copy.whatsappOrderText(order.number, order.code))} rel="noopener noreferrer">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 20l1.4-4.2A8 8 0 1 1 8.6 19z" />
          </svg>
          {copy.whatsappAbout(name)}
        </a>
      ) : null}
      </div>
    </main>
  );
}
