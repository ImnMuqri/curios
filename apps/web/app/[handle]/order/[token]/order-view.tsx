'use client';

import { useEffect, useRef, useState } from 'react';
import { customerSteps, orderView, type OrderStatus } from '@curios/core/orders';
import { formatRinggit } from '@curios/core/store';
import { shopCopy, type ShopCopy } from '../../shop/copy.js';
import { whatsappOrderUrl } from '../../shop/basket.js';
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
    case 'cancelled':
    case 'refundOwed':
      return { text: copy.statusCancelled, tone: 'stop' };
  }
}

/** "Copied" for a moment after a copy, as the board's buttons do. */
function useCopied(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  function copyText(text: string) {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        clearTimeout(timer.current);
        setCopied(true);
        timer.current = setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        // No clipboard: the text is on the screen to read.
      });
  }
  return [copied, copyText];
}

/** The board's download button on the QR's corner: a tick for a moment once saved. */
function SaveQr(props: { url: string; handle: string; copy: ShopCopy }) {
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function save() {
    // A `download` attribute is ignored across origins, and the QR lives on storage's:
    // fetch it and save the bytes from an object URL of this page's own.
    try {
      const response = await fetch(props.url);
      if (!response.ok) throw new Error(String(response.status));
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `${props.handle}-qr.${EXTENSION[blob.type] ?? 'png'}`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
      clearTimeout(timer.current);
      setSaved(true);
      timer.current = setTimeout(() => setSaved(false), 1600);
    } catch {
      // Storage refused the read (CORS, offline): open the picture, to be kept by a long press.
      window.open(props.url, '_blank', 'noopener');
    }
  }

  return (
    <button
      type="button"
      className={styles.save}
      data-saved={saved || undefined}
      aria-label={props.copy.saveQr}
      title={props.copy.saveQrTitle}
      onClick={() => void save()}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d={saved ? 'M5 12.5l4.5 4.5L19 7.5' : 'M12 4v12M7 11l5 5 5-5M5 20h14'} />
      </svg>
    </button>
  );
}

/**
 * The customer's order link (Public board, `order`): where it is, how to pay,
 * and the receipt. Every name and number is this order's and this shop's.
 */
export function OrderView(props: OrderViewProps) {
  const { order, displayName: name } = props;
  const copy = shopCopy(props.language);
  const [codeCopied, copyCode] = useCopied();
  const [accountCopied, copyAccount] = useCopied();

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

  const bankLine = [props.bank.name, props.bank.accountName].filter(Boolean).join(' · ');
  const hasBank = Boolean(bankLine || props.bank.accountNumber);
  const lead = props.qrUrl ? (hasBank ? copy.scanOrTransfer : copy.scanOnly) : copy.transferTo;
  const receiptName = `receipt-${order.number}.${EXTENSION[order.receiptType ?? ''] ?? 'jpg'}`;

  return (
    <main className={`${checkout.column} ${styles.page}`}>
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
              <li key={step.label} className={styles.step} data-state={state}>
                <i aria-hidden="true">
                  {step.done ? (
                    <svg viewBox="0 0 24 24">
                      <path d="M5 12.5l4.5 4.5L19 7.5" />
                    </svg>
                  ) : null}
                </i>
                <span>{step.label}</span>
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
          {props.qrUrl || hasBank ? (
            <div className={styles.payBox}>
              {props.qrUrl ? (
                <span className={styles.qr}>
                  <img src={props.qrUrl} alt={copy.qrLabel(name)} width={104} height={104} />
                  <SaveQr url={props.qrUrl} handle={props.handle} copy={copy} />
                </span>
              ) : null}
              <span className={styles.bank}>
                <span>{lead}</span>
                {bankLine ? <b>{bankLine}</b> : null}
                {props.bank.accountNumber ? (
                  <span className={styles.account}>
                    <code>{props.bank.accountNumber}</code>
                    <button type="button" className={styles.textButton} onClick={() => copyAccount(props.bank.accountNumber ?? '')}>
                      {accountCopied ? copy.copied : copy.copy}
                    </button>
                  </span>
                ) : null}
              </span>
            </div>
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
        <a className={styles.whatsapp} href={whatsappOrderUrl(props.whatsapp, copy.whatsappOrderText(order.number, order.code))} rel="noopener">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 20l1.4-4.2A8 8 0 1 1 8.6 19z" />
          </svg>
          {copy.whatsappAbout(name)}
        </a>
      ) : null}
    </main>
  );
}
