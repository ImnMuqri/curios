'use client';

import { customerSteps, isRiderDelivery, orderView, type OrderStatus } from '@curios/core/orders';
import { formatRinggit } from '@curios/core/store';
import { shopCopy, type ShopCopy } from '../../shop/copy.js';
import { whatsappOrderUrl } from '../../shop/basket.js';
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
  const { order, displayName: name } = props;
  const copy = shopCopy(props.language);
  const [codeCopied, copyCode] = useCopied();

  const facts = {
    status: order.status,
    receiptUploadedAt: date(order.receiptUploadedAt),
    paidAt: date(order.paidAt),
    refundedAt: date(order.refundedAt),
  };
  const view = orderView(facts);
  const steps = customerSteps({ status: order.status, paidAt: facts.paidAt, day: order.day }, new Date(props.now));
  const status = pill(view, steps.ready, name, copy);
  const needPay = view === 'awaitingPayment' || view === 'toCheck';
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

      {needPay ? (
        <section className={checkout.section} aria-labelledby="order-pay">
          <div className={checkout.head}>
            <h2 id="order-pay">{copy.payTitle(total)}</h2>
            <span>{copy.payTo(name)}</span>
          </div>
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
