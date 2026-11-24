'use client';

import { useEffect, useState } from 'react';
import { isFailReason, type FailReason } from '@curios/core/chip-status';
import { customerSteps, isRiderDelivery, orderView, type OrderStatus } from '@curios/core/orders';
import { windowLabel } from '@curios/core/pickup';
import { formatRinggit } from '@curios/core/store';
import { shopCopy, type ShopCopy } from '../../shop/copy.js';
import { whatsappOrderUrl } from '../../shop/basket.js';
import { payingKey, retryKey } from '../../shop/checkout/paying.js';
import { Placed } from '../../shop/checkout/placed.js';
import { unavailableCopy } from '../../../_system/unavailable-copy.js';
import { apiFetch } from '../../../../lib/api.js';
import { TopBar } from '../../top-bar.js';
import sheet from '../../sheet.module.css';
import { DigitalSection, type DigitalLineView } from './digital-section.js';
import { hasBank, PayBox, useCopied } from './pay-box.js';
import { PayFailed } from './pay-failed.js';
import { ReceiptUpload } from './receipt-upload.js';
import { RetryPay } from './retry-pay.js';
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
    /** Null for a digital-only order: nothing to pick up or deliver. */
    method: 'PICKUP' | 'DELIVERY' | null;
    day: string | null;
    /** The pickup place and time the order kept (minutes after midnight); absent or null on an order without them. */
    pickupPlaceName?: string | null;
    /** The place's address as the order kept it, said under the pickup line. */
    pickupPlaceAddress?: string | null;
    pickupFrom?: number | null;
    pickupTo?: number | null;
    itemsCents: number;
    deliveryCents: number;
    totalCents: number;
    /** What the voucher took off (already out of totalCents), and its code or name; absent or 0 for none. */
    discountCents?: number;
    voucherLabel?: string | null;
    status: OrderStatus;
    receiptType: string | null;
    /** ISO times, or null. */
    receiptUploadedAt: string | null;
    receiptRejectedAt: string | null;
    paidAt: string | null;
    refundedAt: string | null;
    /** How it was paid, and for CHIP, how CHIP says and its reference. */
    paidVia?: 'RECEIPT' | 'MANUAL' | 'CHIP' | 'VOUCHER' | null;
    paidMethodLabel?: string | null;
    paidRef?: string | null;
    /** Placed, with a CHIP purchase started for it: the page asks the API how it went. */
    chipPending?: boolean;
    lines: { itemName: string; optionLabel: string | null; unitPriceCents: number; quantity: number; digital?: DigitalLineView | null; /** The item's photo, for the thumbnail; absent for a letter. */ photoUrl?: string | null }[];
    /** When the order was marked done (ISO), said on the Done card. */
    completedAt?: string | null;
    /** Where the digital items were sent, and when they were (ISO). */
    email?: string | null;
    sentAt?: string | null;
  };
  qrUrl: string | null;
  receiptUrl: string | null;
  bank: { name: string | null; accountName: string | null; accountNumber: string | null };
  /** The shop's WhatsApp number; no button without one. */
  whatsapp: string | null;
  /** What the shop's CHIP account takes, for "Try paying again"; null or absent when nothing online. */
  chipMethods?: string[] | null;
  /** Preview only: the shop takes payment online, so the picture says so rather than "no way to pay". */
  previewPaysOnline?: boolean;
  /** The page is suspended: the order shows, but not how to pay it, and the page says it is unavailable. */
  suspended?: boolean;
  /** Where paying again sends the browser. Tests pass a spy. */
  navigate?: (url: string) => void;
  /** The server's clock when it rendered (ISO). */
  now: string;
  /**
   * The Store editor's picture of this page: the same page, but nothing in it
   * reaches the network or the clipboard (the receipt box does not open a
   * picker), and it is a section of the dashboard, not a document of its own.
   */
  preview?: boolean;
}

type Tone = 'wait' | 'check' | 'ok' | 'stop' | 'quiet';

/** What GET /store/orders/:token/pay-status answers. */
type PayStatus =
  | { state: 'paid'; paidAt: string | null; paidMethodLabel: string | null; paidRef: string | null }
  | { state: 'failed'; reason: string; method: string | null }
  | { state: 'pending' | 'none' | 'unknown' };

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
  const [checked, setChecked] = useState<{ check: 'checking' | 'waiting' | 'failed' | null; failed: { reason: FailReason; method: string | null } }>({
    check: pending ? 'checking' : null,
    // Why it failed and how it was tried, for the failed page; held with `check` so they change together.
    failed: { reason: 'unfinished', method: null },
  });
  const setCheck = (check: 'checking' | 'waiting' | 'failed' | null) => setChecked((was) => ({ ...was, check }));
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
          if (status.state === 'failed') setChecked({ check: 'failed', failed: { reason: isFailReason(status.reason) ? status.reason : 'unfinished', method: status.method ?? null } });
          else setCheck(null);
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
  return { check: checked.check, paid, failed: checked.failed };
}

/** The kinds and count of a FILES line's files, for the line's small print. */
function lineFormat(line: DigitalLineView): { kinds: string[]; count: number } | null {
  if (line.delivery !== 'FILES' || line.files.length === 0) return null;
  const kinds = [...new Set(line.files.map((f) => (f.name.includes('.') ? f.name.split('.').pop()!.toUpperCase() : '')).filter(Boolean))];
  return { kinds, count: line.files.length };
}

const date = (iso: string | null) => (iso ? new Date(iso) : null);

const EXTENSION: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };

/** The pill's words and colour, from the Dash board's view and the customer's steps. */
function pill(view: ReturnType<typeof orderView>, ready: boolean, name: string, copy: ShopCopy, digital?: { sent: boolean }): { text: string; tone: Tone } {
  // A digital-only order has nothing to get ready: paid, then sent.
  if (digital && (view === 'paid' || view === 'paidOnline')) return { text: digital.sent ? copy.statusSent : copy.statusPaidDigital, tone: 'ok' };
  switch (view) {
    case 'awaitingPayment':
      return { text: copy.statusWaiting, tone: 'wait' };
    case 'toCheck':
      return { text: copy.statusChecking(name), tone: 'check' };
    case 'paid':
    case 'paidOnline':
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
 * The customer's order link (deleted Public board, `order`): where it is, how to pay,
 * and the receipt. Every name and number is this order's and this shop's.
 */
export function OrderView(props: OrderViewProps) {
  const { displayName: name, preview = false } = props;
  const Root = preview ? 'div' : 'main';
  const Title = preview ? 'h2' : 'h1';
  const copy = shopCopy(props.language);
  const [codeCopied, copyCode] = useCopied();
  const { check, paid: confirmed, failed } = usePaymentCheck(props.token, props.order.status === 'PLACED' && props.order.chipPending === true);
  // Paid while the customer was at CHIP (or, by the callback, before this page rendered).
  const order: OrderViewProps['order'] = confirmed
    ? { ...props.order, status: 'PAID', paidVia: 'CHIP', paidAt: confirmed.paidAt, paidMethodLabel: confirmed.paidMethodLabel, paidRef: confirmed.paidRef, chipPending: false }
    : props.order;
  const paidOnline = order.paidVia === 'CHIP' && (order.status === 'PAID' || order.status === 'COMPLETED');
  // An order a voucher took to RM0 is paid at once: nothing to pay, check or send a receipt for.
  const paidByVoucher = order.paidVia === 'VOUCHER' && (order.status === 'PAID' || order.status === 'COMPLETED');

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
  // Checkout was told too many tries: the retry it could not offer is here.
  const [triedTooOften, setTriedTooOften] = useState(false);
  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(retryKey(props.token)) === '1') setTriedTooOften(true);
    } catch {
      // No storage: a failed payment still brings the retry.
    }
  }, [props.token]);

  // "Get your files" lands on the downloads once the placed screen has gone.
  const [jump, setJump] = useState(false);
  useEffect(() => {
    if (celebrate || !jump) return;
    setJump(false);
    document.getElementById('downloads')?.scrollIntoView({ block: 'start' });
  }, [celebrate, jump]);

  function seeOrder() {
    if (props.order.method === null) setJump(true);
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
    totalCents: order.totalCents,
  };
  const view = orderView(facts);
  const steps = customerSteps({ status: order.status, paidAt: facts.paidAt, day: order.day }, new Date(props.now));
  const digitalOnly = order.method === null;
  const digitalLines = order.lines.flatMap((line) => (line.digital ? [line.digital] : []));
  const hasDigital = order.lines.some((line) => line.digital);
  const sent = (order.sentAt ?? null) !== null;
  const isPaid = order.status === 'PAID' || order.status === 'COMPLETED';
  const status = pill(view, steps.ready, name, copy, digitalOnly ? { sent } : undefined);
  // While a payment is being checked the QR stays away, so nobody pays twice; once the wait
  // drags on, it comes back under the wait, with a word against paying twice.
  const inFlight = check === 'checking' || check === 'waiting';
  const suspended = props.suspended === true;
  const needPay = !suspended && (view === 'awaitingPayment' || view === 'toCheck') && check !== 'checking';
  const stopped = order.status === 'CANCELLED';
  const total = formatRinggit(order.totalCents);
  const payByQr = Boolean(props.qrUrl) || hasBank(props.bank);
  const chipMethods = props.chipMethods ?? null;
  // Online choices again (DEVIATIONS 178): once a payment failed or was tried too often, and
  // always where online is the shop's only way to pay. Never while one is still in flight,
  // and never once a receipt is sent: a second payment would leave two for one order.
  const retry = view === 'awaitingPayment' && needPay && !inFlight && chipMethods !== null && (!payByQr || check === 'failed' || triedTooOften);
  // A shop with no QR or bank: its WhatsApp, with the upload, or, with neither, the plain truth.
  const askOnWhatsApp = !payByQr && !retry && props.whatsapp !== null;

  const stepList = digitalOnly
    ? [
        { label: copy.steps.placed, done: steps.placed },
        { label: copy.steps.paid, done: steps.paid },
        { label: copy.steps.sent, done: steps.paid && sent },
      ]
    : [
        { label: copy.steps.placed, done: steps.placed },
        { label: copy.steps.paid, done: steps.paid },
        { label: copy.steps.ready, done: steps.ready },
        { label: copy.steps.done, done: steps.done },
      ];
  // The step being waited on: the first one not yet lit.
  const nowAt = stepList.findIndex((step) => !step.done);

  const kinds = [...new Set(digitalLines.map((line) => line.delivery))];
  const receiptName = `receipt-${order.number}.${EXTENSION[order.receiptType ?? ''] ?? 'jpg'}`;

  // A payment that did not go through, with nothing else in the way: its own page. With a receipt
  // sent or the page suspended, the order page stays and says it in a line.
  if (check === 'failed' && view === 'awaitingPayment' && !suspended && !preview) {
    return (
      <main className={`${checkout.column} ${checkout.placedColumn}`}>
        <PayFailed
          token={props.token}
          handle={props.handle}
          displayName={name}
          copy={copy}
          code={order.code}
          lines={order.lines}
          totalCents={order.totalCents}
          reason={failed.reason}
          method={failed.method}
          chipMethods={chipMethods}
          navigate={props.navigate}
        />
      </main>
    );
  }

  if (celebrate) {
    return (
      <main className={`${checkout.column} ${checkout.placedColumn}`}>
        <Placed
          handle={props.handle}
          displayName={name}
          copy={copy}
          number={order.number}
          code={order.code}
          token={props.token}
          totalCents={order.totalCents}
          whatsapp={props.whatsapp}
          summary={{
            how:
              order.method !== null && order.day !== null
                ? {
                    label: order.method === 'PICKUP' ? copy.pickupLabel : copy.deliveryLabel,
                    value: [copy.dayLong(order.day), order.method === 'PICKUP' ? order.pickupPlaceName : null].filter(Boolean).join(' · '),
                  }
                : null,
            count: order.lines.reduce((sum, line) => sum + line.quantity, 0),
            thumbs: order.lines.map((line) => ({ name: line.itemName, url: line.photoUrl ?? null })),
          }}
          onSeeOrder={seeOrder}
          paidDigital={digitalOnly ? { what: copy.digWhat(kinds) } : null}
          digitalNote={hasDigital && order.email ? copy.digitalPlacedNote(true, order.email) : null}
        />
      </main>
    );
  }

  const pickup = order.method === 'PICKUP';
  // The board's state cards: ready, done, refund due. Each replaces the paid line it supersedes.
  const readyCard = !stopped && steps.ready && !steps.done && (view === 'paid' || view === 'paidOnline') && order.method !== null;
  const doneCard = view === 'completed' && order.method !== null;
  const refundCard = view === 'refundOwed';
  const dayLabel = order.day ? copy.dayLong(order.day) : null;
  const slot = order.pickupFrom != null && order.pickupTo != null ? windowLabel(order.pickupFrom, order.pickupTo) : null;
  const when = [dayLabel, slot].filter(Boolean).join(', ');
  const placeLine = [order.pickupPlaceName, order.pickupPlaceAddress].filter(Boolean).join(' · ');
  const showGet = !stopped && !doneCard && !refundCard && order.method !== null && order.day !== null;

  return (
    <Root className={checkout.column}>
      {/* Back to the shop, as checkout's top bar has it: a paid order is not a dead end (owner, 12 Nov 2026). */}
      <TopBar title={name} back={{ href: preview ? undefined : `/${props.handle}/shop`, label: copy.backToShop }} />

      <div className={`${sheet.sheet} ${checkout.sheet} ${styles.sheet}`} data-testid="sheet">
      <p className={styles.kicker}>
        {copy.orderKicker(order.number, order.code)}
        <button type="button" className={styles.textButton} onClick={preview ? undefined : () => copyCode(order.code)}>
          {codeCopied ? copy.copied : copy.copyCode}
        </button>
      </p>
      <div className={styles.titleRow}>
        <Title className={styles.heading}>{copy.yourOrder}</Title>
        <span className={styles.pill} data-tone={status.tone}>
          <i aria-hidden="true" />
          {status.text}
        </span>
      </div>

      {stopped ? null : (
        <ol className={styles.bars} aria-label={copy.orderProgress}>
          {stepList.map((step, i) => {
            const state = step.done ? 'done' : i === nowAt ? 'now' : undefined;
            return (
              <li key={step.label} className={styles.bar} data-state={state} aria-current={state === 'now' ? 'step' : undefined}>
                {step.label}
                {/* The bar says it to the eye; this says it to a screen reader. */}
                {step.done ? <span className={styles.srOnly}>{`, ${copy.stepDone}`}</span> : null}
              </li>
            );
          })}
        </ol>
      )}

      {readyCard ? (
        <div className={styles.state} role="status">
          <b>{pickup ? copy.readyPickupTitle : copy.readyDeliveryTitle}</b>
          <small>{pickup ? copy.readyPickupBody(when) : copy.readyDeliveryBody(dayLabel ?? '')}</small>
        </div>
      ) : null}

      {doneCard ? (
        <div className={styles.state}>
          <b>{pickup ? copy.pickedUp : copy.deliveredDone}</b>
          {order.completedAt ? <small>{copy.paidTime(order.completedAt)}</small> : null}
        </div>
      ) : null}

      {refundCard ? (
        <div className={styles.state} data-tone="bad">
          <b>{copy.refundTitle(name)}</b>
          <small>{copy.refundBody(total, name)}</small>
        </div>
      ) : null}

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

      {paidOnline && !readyCard && !doneCard ? (
        <div className={styles.state}>
          <b>{copy.paidBy(total, copy.methodLabel(order.paidMethodLabel ?? 'CHIP'))}</b>
          {order.paidAt ? <small>{order.paidRef ? copy.paidWhen(copy.paidTime(order.paidAt), order.paidRef) : copy.paidTime(order.paidAt)}</small> : null}
        </div>
      ) : null}
      {paidOnline && (readyCard || doneCard) ? (
        // The state card says where the order is; how it was paid stays as a quiet line under it.
        <p className={styles.paidNote}>
          <span>{copy.paidBy(total, copy.methodLabel(order.paidMethodLabel ?? 'CHIP'))}</span>
          {order.paidAt ? <span>{order.paidRef ? copy.paidWhen(copy.paidTime(order.paidAt), order.paidRef) : copy.paidTime(order.paidAt)}</span> : null}
        </p>
      ) : null}

      {paidByVoucher ? (
        <section className={checkout.section}>
          <div className={`${styles.upload} ${styles.sent}`}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
            <span>
              <b>{copy.paidWithVoucher}</b>
              {order.paidAt ? <span>{copy.paidTime(order.paidAt)}</span> : null}
            </span>
          </div>
        </section>
      ) : null}

      {suspended ? (
        <section className={checkout.section} aria-labelledby="order-unavailable">
          <p className={styles.askPay}>
            <b id="order-unavailable">{unavailableCopy(props.language).title}</b> {unavailableCopy(props.language).lede}
          </p>
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
          {retry && chipMethods ? (
            <RetryPay
              token={props.token}
              handle={props.handle}
              displayName={name}
              copy={copy}
              totalCents={order.totalCents}
              chipMethods={chipMethods}
              withQr={payByQr}
              navigate={props.navigate}
            />
          ) : null}
          {payByQr ? (
            <PayBox
              name={name}
              qrUrl={props.qrUrl}
              bank={props.bank}
              copy={copy}
              saveHref={preview ? undefined : `/${props.handle}/order/${encodeURIComponent(props.token)}/qr`}
              preview={preview}
            />
          ) : askOnWhatsApp ? (
            <p className={styles.askPay}>{copy.askHowToPay(name)}</p>
          ) : retry ? null : (
            // The editor's picture says what the owner must do; a customer is told the shop cannot take it online.
            <p className={styles.askPay}>{preview ? (props.previewPaysOnline ? copy.paysOnlinePreview : copy.noWayToPay) : copy.cantPayOnline(name)}</p>
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
            <ReceiptUpload token={props.token} displayName={name} copy={copy} replace preview={preview} />
          ) : payByQr || askOnWhatsApp ? (
            <ReceiptUpload token={props.token} displayName={name} copy={copy} preview={preview} />
          ) : null}
        </section>
      ) : null}

      {hasDigital && !stopped && (view === 'awaitingPayment' || view === 'toCheck') ? (
        <section className={checkout.section}>
          <div className={styles.dgLock}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 11h12v10H6zM8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
            <span>
              <b>{copy.dgLockTitle(copy.digWhat(kinds))}</b>
              {view === 'toCheck' ? <span>{copy.dgLockCheck(name)}</span> : needPay ? <span>{copy.dgLockPay}</span> : null}
            </span>
          </div>
        </section>
      ) : null}

      {hasDigital && isPaid ? (
        <DigitalSection
          lines={digitalLines}
          token={props.token}
          handle={props.handle}
          name={name}
          email={order.email ?? null}
          copy={copy}
          now={props.now}
          paused={suspended}
          onlyFiles={kinds.length === 1 && kinds[0] === 'FILES'}
        />
      ) : null}

      {showGet ? (
        <div className={styles.get}>
          <b>
            {pickup
              ? `${copy.pickupLabel} · ${when}`
              : `${copy.deliveryLabel} · ${dayLabel}${isRiderDelivery({ method: 'DELIVERY', deliveryCents: order.deliveryCents }) ? ` · ${copy.riderPaidSeparately}` : ''}`}
          </b>
          {pickup && placeLine ? <span>{placeLine}</span> : null}
          {pickup ? (
            <a className={styles.cal} href={preview ? undefined : `/${props.handle}/order/${encodeURIComponent(props.token)}/calendar?pickup=1`}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 6h16v14H4zM4 10h16M8 3v5M16 3v5" />
              </svg>
              {copy.addToCalendar}
            </a>
          ) : null}
        </div>
      ) : null}
      {order.method === null ? <p className={styles.lab}>{copy.byEmail}</p> : null}

      <h2 id="order-lines" className={styles.lab}>
        {copy.whatYouOrdered}
      </h2>
      <ul className={styles.items} aria-labelledby="order-lines">
        {order.lines.map((line, i) => {
          const small = [
            line.quantity > 1 ? `${line.quantity}×` : null,
            line.digital
              ? copy.digitalSub({ delivery: line.digital.delivery, format: lineFormat(line.digital), minutes: line.digital.minutes, place: line.digital.place }, line.digital.startsAt ? copy.sessionTime(line.digital.startsAt) : null)
              : line.optionLabel,
          ]
            .filter(Boolean)
            .join(' · ');
          return (
            <li key={i} className={styles.ln}>
              <i aria-hidden="true">{line.photoUrl ? <img src={line.photoUrl} alt="" /> : line.itemName.trim().charAt(0).toUpperCase()}</i>
              <span>
                <b>{line.itemName}</b>
                {small ? <small>{small}</small> : null}
              </span>
              <em>{formatRinggit(line.unitPriceCents * line.quantity)}</em>
            </li>
          );
        })}
        {order.deliveryCents > 0 ? (
          <li className={styles.row}>
            <span>{copy.deliveryLabel}</span>
            <span>{formatRinggit(order.deliveryCents)}</span>
          </li>
        ) : null}
        {(order.discountCents ?? 0) > 0 ? (
          <li className={styles.row}>
            <span>{copy.voucherApplied(order.voucherLabel ?? 'Voucher', formatRinggit(order.discountCents ?? 0))}</span>
          </li>
        ) : null}
        <li className={`${styles.row} ${styles.totalRow}`}>
          <span>{copy.total}</span>
          <b>{total}</b>
        </li>
      </ul>

      {props.whatsapp ? (
        <a className={styles.whatsapp} href={whatsappOrderUrl(props.whatsapp, copy.whatsappOrderText(order.number, order.code))} rel="noopener noreferrer">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 20l1.4-4.2A8 8 0 1 1 8.6 19z" />
          </svg>
          {copy.whatsappAbout(name)}
        </a>
      ) : null}
      <p className={styles.foot}>
        <b>{copy.keepPage}</b> {copy.askLater(name, order.code)}
      </p>
      </div>
    </Root>
  );
}
