'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { orderView, type OrderView } from '@curios/core/orders';
import { formatMalaysianPhone } from '@curios/core/phone';
import { formatRinggit } from '@curios/core/store';
import type { OwnerOrder } from '@curios/db-read';
import { Callout } from '@curios/ui';
import { ApiError } from '../../../lib/api.js';
import inbox from '../_ui/inbox.module.css';
import { waNumber } from '../leads/first-message.js';
import styles from './orders.module.css';
import { SentByEmail, type DigitalAct } from './sent-by-email.js';

/** An order as the screen gets it: the receipt and photos as addresses, never storage keys. */
export type OrderRow = Omit<OwnerOrder, 'receiptKey' | 'lines'> & {
  receiptUrl: string | null;
  lines: (Omit<OwnerOrder['lines'][number], 'photoKey'> & { photoUrl: string | null })[];
};

/** The owner's moves, one per endpoint (`POST /orders/:id/<action>`). */
export type OrderAction = 'paid' | 'not-received' | 'completed' | 'cancel' | 'refunded';
export type OrderMove = (orderId: string, action: OrderAction) => Promise<void>;

const KL = 'Asia/Kuala_Lumpur';
const DAY_MS = 86_400_000;
const dayOf = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: KL }).format(date);

/** "10:02am", in Malaysia. */
function clock(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: KL, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${hour % 12 || 12}:${minute}${hour < 12 ? 'am' : 'pm'}`;
}

/** "today, 10:02am", "yesterday, 9:15pm", "Tue, 2:31pm", "3 Oct, 11:00am": the board's way of saying when. */
export function orderWhen(date: Date, now: Date): string {
  const day = dayOf(date);
  if (day === dayOf(now)) return `today, ${clock(date)}`;
  if (day === dayOf(new Date(now.getTime() - DAY_MS))) return `yesterday, ${clock(date)}`;
  const options: Intl.DateTimeFormatOptions =
    now.getTime() - date.getTime() < 7 * DAY_MS ? { weekday: 'short', timeZone: KL } : { day: 'numeric', month: 'short', timeZone: KL };
  return `${new Intl.DateTimeFormat('en-GB', options).format(date)}, ${clock(date)}`;
}

/** "Sat 17 Oct", from the order's calendar day. */
export function dayLabel(day: string | null): string {
  if (day === null) return '';
  const parts = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).formatToParts(new Date(`${day}T00:00:00Z`));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('weekday')} ${part('day')} ${part('month')}`;
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

export const itemCount = (order: OrderRow) => order.lines.reduce((sum, line) => sum + line.quantity, 0);

export const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** `orderView`, plus Sent: a digital-only order that has been delivered (the board's `view()` reads it as Sent, not Completed). */
export type OwnerView = OrderView | 'sent';

export function ownerView(order: OrderRow): OwnerView {
  const view = orderView(order);
  const delivered = view === 'paid' || view === 'paidOnline' || view === 'completed';
  return delivered && order.method === null && order.sentAt !== null ? 'sent' : view;
}

/** The board's badges, by `orderView`. A refunded order reads Cancelled in the list, as the board's `view()` has it. */
export const BADGES: Record<OwnerView, { label: string; tone: 'grey' | 'kuning' | 'biru' | 'hijau' | 'merah' | 'muted' }> = {
  awaitingPayment: { label: 'Awaiting payment', tone: 'grey' },
  toCheck: { label: 'To check', tone: 'kuning' },
  paid: { label: 'Paid', tone: 'biru' },
  // CHIP confirmed it: green like Completed, so it reads apart from a payment the owner marked by hand.
  paidOnline: { label: 'Paid online', tone: 'hijau' },
  completed: { label: 'Completed', tone: 'hijau' },
  // A digital-only order, delivered: nothing to make and nothing to complete, so Sent is where it ends.
  sent: { label: 'Sent', tone: 'hijau' },
  refundOwed: { label: 'Refund owed', tone: 'merah' },
  refunded: { label: 'Cancelled', tone: 'muted' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
};

const AVATAR_TONES = ['pink', 'blue', 'mint', 'peach', 'sand', 'sage', 'sky'] as const;

/** The customer's initial on a soft colour, the same colour every time for the same order. */
export function Initial({ order, big = false }: { order: Pick<OrderRow, 'customerName' | 'number'>; big?: boolean }) {
  return (
    <span className={styles.avatar} data-tone={AVATAR_TONES[order.number % AVATAR_TONES.length]} data-big={big || undefined} aria-hidden="true">
      {order.customerName.trim().charAt(0).toUpperCase()}
    </span>
  );
}

const TICK = 'M5 12.5l4.5 4.5L19 7.5';
const CROSS = 'M7 7l10 10M17 7L7 17';
const PIN = 'M12 21s-7-5.6-7-11a7 7 0 0 1 14 0c0 5.4-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z';
const VAN = 'M3 7h11v9H3zM14 10h4l3 3v3h-7M7.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM17.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z';
const CHAT = 'M4 20l1.4-4.2A8 8 0 1 1 8.6 19z';
const CLOCK = 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2';
const FILE = 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4';
const RAYS = [0, 45, 90, 135, 180, 225, 270, 315];

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };

type Ask = { tone: 'biru' | 'grey' | 'hijau' | 'merah'; title: string; text: string; button: string; action: OrderAction; toast: string };

/**
 * One order: who and when, its four steps, the one thing to do next, what
 * was ordered, the payment with its receipt, and how it gets to them.
 *
 * The action box's words are the board's `ab`, word for word. Not received
 * (owner decision 3) sits beside Mark paid while a receipt is in; it removes
 * the receipt, so it asks first, as Cancel does.
 */
export function OrderDetail({
  order,
  now,
  pickupNote,
  move,
  act,
  say,
  onChanged,
}: {
  order: OrderRow;
  now: Date;
  /** Where pickup happens, as the Store settings say it. */
  pickupNote: string | null;
  move: OrderMove;
  /** The owner's moves on what was sent by email: new links, a new code, another time, the email again. */
  act: DigitalAct;
  /** The screen's toast, which outlives this panel. */
  say: (text: string) => void;
  /** After a move: read the server again, for the list and the figures. */
  onChanged: () => void;
}) {
  const [confirming, setConfirming] = useState<'cancel' | 'not-received' | null>(null);
  const [refunding, setRefunding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(false);
  const [sparks, setSparks] = useState(0);
  const inFlight = useRef(false);
  const zoomTrigger = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const view = ownerView(order);
  // A digital-only order has no method and no day: it is paid, then sent, and nothing is made or completed.
  const digitalOnly = order.method === null;
  const hasDigital = order.lines.some((line) => line.digital !== null);
  const first = firstName(order.customerName);
  const total = formatRinggit(order.totalCents);
  const cancelled = order.status === 'CANCELLED';
  const hasReceipt = order.receiptUploadedAt !== null;
  const when = (date: Date) => orderWhen(date, now);
  // Confirmed by CHIP: no receipt, nothing for the owner to check.
  const online = order.paidVia === 'CHIP' && order.paidAt !== null;
  const via = order.paidMethodLabel ?? 'CHIP';
  // CHIP also took the money for an order paid another way: one of the two is owed back.
  const paidTwice = order.chipPaidTwiceAt !== null;
  const secondOwed = paidTwice && order.secondRefundedAt === null;

  // A fresh read of this order: whatever was in flight has landed, and its buttons are live again.
  useEffect(() => {
    inFlight.current = false;
    setBusy(false);
  }, [order]);

  // The large receipt takes focus onto its close button and gives it back to the thumbnail.
  useEffect(() => {
    if (!zoom) return;
    closeRef.current?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setZoom(false);
    };
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('keydown', close);
      zoomTrigger.current?.focus();
    };
  }, [zoom]);

  useEffect(() => {
    if (!sparks) return;
    const t = setTimeout(() => setSparks(0), 560);
    return () => clearTimeout(t);
  }, [sparks]);

  // The last step: Completed, or Sent for a digital-only order (when it was delivered, or what delivers it).
  const end: [string, string, boolean] = digitalOnly
    ? ['Sent', order.sentAt ? when(order.sentAt) : online ? 'Not yet' : 'When you mark it paid', order.sentAt !== null]
    : ['Completed', order.completedAt ? when(order.completedAt) : dayLabel(order.day), order.completedAt !== null];
  // The board's stepsRaw: [label, when, done].
  const steps: [string, string, boolean][] = cancelled
    ? [
        ['Placed', when(order.createdAt), true],
        ['Receipt', order.receiptUploadedAt ? when(order.receiptUploadedAt) : 'None', hasReceipt],
        ['Paid', order.paidAt ? when(order.paidAt) : 'No', order.paidAt !== null],
        [order.refundedAt ? 'Refunded' : 'Cancelled', when(order.refundedAt ?? order.cancelledAt ?? order.createdAt), true],
      ]
    : online
      ? [
          ['Placed', when(order.createdAt), true],
          ['Paid by ' + via.split(' · ')[0], when(order.paidAt!), true],
          ['Checked', 'By the bank', true],
          end,
        ]
      : [
        ['Placed', when(order.createdAt), true],
        // Marked paid some other way: there is no receipt to wait for.
        ['Receipt', order.receiptUploadedAt ? when(order.receiptUploadedAt) : order.paidAt ? 'None' : 'Waiting', hasReceipt],
        ['Paid', order.paidAt ? when(order.paidAt) : hasReceipt ? 'Your check' : 'Not yet', order.paidAt !== null],
        end,
      ];
  const doneCount = steps.filter((s) => s[2]).length;
  const lastDone = steps.reduce((at, s, i) => (s[2] ? i : at), 0);
  // The step after the last one done; a step skipped on the way (no receipt, paid another way) is not "next".
  // A cancelled order rings its first step not reached, as the board's findIndex(!done) does.
  const next = cancelled ? steps.findIndex((s) => !s[2]) : steps.findIndex((s, i) => !s[2] && i > lastDone);
  const fill = doneCount <= 1 ? 0 : (lastDone / 3) * 75;

  const sendsMail = hasDigital && order.email !== null;
  const only = order.lines.length === 1 ? order.lines[0]!.itemName.toLowerCase() : 'items';
  let ask: Ask | null = null;
  if (view === 'toCheck' && sendsMail)
    ask = {
      tone: 'biru',
      title: 'Check the receipt, then mark it paid',
      text: digitalOnly ? `Their ${only} goes to ${order.email} the moment you do.` : `Make sure ${total} reached your account. Their digital items go to ${order.email} the moment you do.`,
      button: 'Mark paid and send',
      action: 'paid',
      toast: digitalOnly ? `#${order.number} paid. It’s on its way to ${first}’s email.` : `#${order.number} marked paid. The digital items are on their way to ${first}’s email.`,
    };
  else if (view === 'toCheck')
    ask = {
      tone: 'biru',
      title: 'Check the receipt, then mark it paid',
      text: `Make sure ${total} reached your account.`,
      button: 'Mark paid',
      action: 'paid',
      toast: `#${order.number} marked paid. ${first} can see it on their order page.`,
    };
  else if (view === 'awaitingPayment' && sendsMail)
    ask = {
      tone: 'grey',
      title: `Waiting for ${first} to pay`,
      text: digitalOnly ? `Paid some other way? Mark it paid and their ${only} goes to ${order.email}.` : `Paid some other way? Mark it paid and their digital items go to ${order.email}.`,
      button: 'Mark paid and send',
      action: 'paid',
      toast: digitalOnly ? `#${order.number} paid. It’s on its way to ${first}’s email.` : `#${order.number} marked paid. The digital items are on their way to ${first}’s email.`,
    };
  else if (view === 'awaitingPayment')
    ask = {
      tone: 'grey',
      title: `Waiting for ${first} to pay`,
      text: 'Paid some other way? You can still mark it paid.',
      button: 'Mark paid',
      action: 'paid',
      toast: `#${order.number} marked paid.`,
    };
  // A digital-only order has nothing to make: once paid it is sent, and Sent is where it ends.
  else if ((view === 'paid' || view === 'paidOnline') && !digitalOnly)
    ask = {
      tone: 'hijau',
      title: `Paid. Ready on ${dayLabel(order.day)}`,
      text: `Mark it completed once ${first} has it.`,
      button: 'Mark completed',
      action: 'completed',
      toast: `#${order.number} completed. Nice one.`,
    };
  else if (view === 'refundOwed')
    ask = {
      tone: 'merah',
      title: `You owe ${first} ${total}`,
      text: secondOwed ? 'Send it back yourself and refund the CHIP payment too, then mark it refunded.' : 'Send it back yourself, then mark it refunded.',
      button: 'Mark refunded',
      action: 'refunded',
      toast: `#${order.number} marked refunded.`,
    };
  const canCancel = order.status === 'PLACED' || order.status === 'PAID';

  async function run(action: OrderAction, toast: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      await move(order.id, action);
      setConfirming(null);
      setRefunding(false);
      setSparks((n) => n + 1);
      say(toast);
      // Still busy: the buttons on screen are this order's old state until
      // the server's read arrives (the effect on `order` frees them).
      onChanged();
    } catch (failure) {
      inFlight.current = false;
      setBusy(false);
      setError(failure instanceof Error && failure.message ? failure.message : 'That did not save. Try again.');
      // Gone, or moved on elsewhere (another tab): read it again, as the words say.
      if (failure instanceof ApiError && (failure.status === 404 || failure.status === 409)) onChanged();
    }
  }

  const question =
    confirming === 'cancel'
      ? order.status === 'PAID'
        ? `Cancel #${order.number}? You will owe ${first} ${total}.`
        : view === 'toCheck'
          ? // Not marked paid, so cancelling tracks no refund: say how to make it.
            `Cancel #${order.number}? ${first}’s receipt is in. If the money arrived, mark it paid first, so cancelling records the refund you owe.`
          : `Cancel #${order.number}?`
      : `Mark the receipt not received? ${first} will be asked to pay again.`;

  const paymentBadge =
    view === 'toCheck'
      ? { label: 'Receipt to check', tone: 'kuning' }
      : order.paidAt
        ? order.refundedAt && cancelled
          ? { label: 'Refunded', tone: 'grey' }
          : { label: `Paid ${when(order.paidAt)}`, tone: 'hijau' }
        : { label: 'Not paid', tone: BADGES[view].tone };
  const isPdf = order.receiptType === 'application/pdf';
  const file = `receipt-${first.toLowerCase()}.${EXT[order.receiptType ?? ''] ?? 'jpg'}`;
  const waitText =
    order.status !== 'PLACED'
      ? 'No receipt was uploaded.'
      : order.receiptRejectedAt
        ? `You marked the receipt not received. ${first}’s order page asks them to pay again.`
        : `${first} has not uploaded a receipt yet. Their order page shows your QR and bank details.`;
  const count = itemCount(order);

  return (
    <div className={inbox.detailInner}>
      <div className={styles.head}>
        <Initial order={order} big />
        <span className={styles.headText}>
          <h2>
            #{order.number} · {order.customerName}
          </h2>
          <p>
            Placed {when(order.createdAt)} · {formatMalaysianPhone(order.phone)}
          </p>
        </span>
        <a className={styles.whatsapp} href={`https://wa.me/${waNumber(order.phone)}`} target="_blank" rel="noopener noreferrer">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d={CHAT} />
          </svg>
          WhatsApp {first}
        </a>
      </div>

      <div className={styles.progress}>
        <span className={styles.rail} aria-hidden="true" />
        <span className={styles.fill} data-cancelled={cancelled || undefined} style={{ width: `${fill}%` }} aria-hidden="true" />
        <ol className={styles.steps} aria-label="Order progress">
          {steps.map(([label, at, done], i) => {
            const isEnd = i === 3;
            const state = done ? (cancelled && isEnd && !order.refundedAt ? 'cancel' : isEnd && !cancelled ? 'complete' : 'done') : i === next ? 'next' : 'todo';
            return (
              // The ring only, on a cancelled order: nothing there is the current step.
              <li key={label} className={styles.step} aria-current={i === next && !cancelled ? 'step' : undefined}>
                <span className={styles.node} data-state={state} aria-hidden="true">
                  {done ? (
                    <svg viewBox="0 0 24 24">
                      <path d={state === 'cancel' ? CROSS : TICK} />
                    </svg>
                  ) : null}
                </span>
                <b>{label}</b>
                <span>{at}</span>
              </li>
            );
          })}
        </ol>
      </div>

      {ask ? (
        <section className={styles.actbar} data-tone={ask.tone} aria-label="What to do next">
          <p className={styles.actText}>
            <b>{ask.title}</b>
            <span>{ask.text}</span>
          </p>
          {confirming ? (
            <span className={styles.confirm} role="group" aria-label={confirming === 'cancel' ? 'Confirm cancelling this order' : 'Confirm the receipt was not received'}>
              {question}
              <button type="button" data-tone="merah" disabled={busy} onClick={() => void (confirming === 'cancel' ? run('cancel', `#${order.number} cancelled.${order.paidAt ? ' A refund is owed.' : ''}`) : run('not-received', `#${order.number}: receipt marked not received. ${first} will be asked to pay again.`))}>
                {confirming === 'cancel' ? 'Yes, cancel' : 'Yes, not received'}
              </button>
              <button type="button" disabled={busy} onClick={() => setConfirming(null)}>
                Keep
              </button>
            </span>
          ) : (
            <span className={styles.actions}>
              {canCancel ? (
                <button type="button" className={styles.ghost} disabled={busy} onClick={() => setConfirming('cancel')}>
                  Cancel order
                </button>
              ) : null}
              {view === 'toCheck' ? (
                <button type="button" className={styles.outline} disabled={busy} onClick={() => setConfirming('not-received')}>
                  Not received
                </button>
              ) : null}
              <button type="button" className={styles.big} data-tone={ask.tone} disabled={busy} onClick={() => void run(ask.action, ask.toast)}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d={TICK} />
                </svg>
                {ask.button}
                {sparks ? RAYS.map((r) => <span key={`${sparks}-${r}`} className={styles.ray} style={{ '--r': `${r}deg` } as CSSProperties} aria-hidden="true" />) : null}
              </button>
            </span>
          )}
        </section>
      ) : null}

      {error ? (
        <div className={styles.error}>
          <Callout tone="error">{error}</Callout>
        </div>
      ) : null}

      <div className={styles.grid}>
        <section className={styles.card} aria-labelledby="order-items">
          <h3 className={styles.cardTitle} id="order-items">
            Items <span>{plural(count, 'item')}</span>
          </h3>
          {order.lines.map((line, i) => (
            <div key={i} className={styles.line}>
              <span className={styles.thumb} data-tone={i % 2 ? 'peach' : 'pink'} aria-hidden="true">
                {line.photoUrl ? <img src={line.photoUrl} alt="" /> : line.itemName.trim().charAt(0).toUpperCase()}
              </span>
              <span className={styles.lineName}>
                <b>
                  {line.quantity}× {line.itemName}
                </b>
                <span>{`${line.optionLabel ? `${line.optionLabel} · ` : ''}${formatRinggit(line.unitPriceCents)} each`}</span>
              </span>
              <span className={styles.amount}>{formatRinggit(line.unitPriceCents * line.quantity)}</span>
            </div>
          ))}
          {order.deliveryCents > 0 ? (
            <div className={styles.line}>
              <span className={styles.thumb} data-tone="mint" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="18" height="18">
                  <path d={VAN} />
                </svg>
              </span>
              <span className={styles.lineName}>
                <b>Delivery</b>
                <span>Flat fee</span>
              </span>
              <span className={styles.amount}>{formatRinggit(order.deliveryCents)}</span>
            </div>
          ) : null}
          <div className={styles.total}>
            <span>Total</span>
            <b>{total}</b>
          </div>
        </section>

        <div className={styles.side}>
          <section className={styles.card} aria-labelledby="order-payment">
            <h3 className={styles.cardTitle} id="order-payment">
              Payment{' '}
              <span className={styles.badge} data-badge="" data-tone={paymentBadge.tone}>
                {paymentBadge.label}
              </span>
            </h3>
            {online ? (
              <div className={styles.paidOnline}>
                <span className={styles.paidTick} aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path d={TICK} />
                  </svg>
                </span>
                <span>
                  <b>
                    {total} paid by {via}
                  </b>
                  <span>{`Confirmed by the bank through CHIP${paidTwice && hasReceipt ? '. A receipt was also sent — check it before you refund one.' : ', so there is no receipt to check.'}${order.paidRef ? ` Ref ${order.paidRef}.` : ''}`}</span>
                </span>
              </div>
            ) : null}
            {hasReceipt && (!online || paidTwice) ? (
              <div className={styles.receipt}>
                {order.receiptUrl && isPdf ? (
                  <a className={styles.receiptThumb} data-pdf="" href={order.receiptUrl} target="_blank" rel="noopener noreferrer" aria-label="Open the receipt">
                    <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">
                      <path d={FILE} />
                    </svg>
                    <small>PDF</small>
                  </a>
                ) : order.receiptUrl ? (
                  <button ref={zoomTrigger} type="button" className={styles.receiptThumb} aria-label="Open the receipt" onClick={() => setZoom(true)}>
                    <img src={order.receiptUrl} alt="" />
                  </button>
                ) : (
                  <span className={styles.receiptThumb} data-pdf="" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="30" height="30">
                      <path d={FILE} />
                    </svg>
                  </span>
                )}
                <span className={styles.receiptText}>
                  <b>{file}</b>
                  {order.receiptUploadedAt ? <span>Uploaded {when(order.receiptUploadedAt)}</span> : null}
                  <span className={styles.match}>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d={TICK} />
                    </svg>
                    Should show {total}
                  </span>
                  {online ? null : <span className={styles.hint}>Check it landed in your account before you mark it paid.</span>}
                </span>
              </div>
            ) : !online ? (
              <div className={styles.waitbox}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d={CLOCK} />
                </svg>
                {waitText}
              </div>
            ) : null}
            {/* CHIP took the money on top of the QR or a hand-marked payment (DEVIATIONS 187). */}
            {secondOwed ? (
              <div className={styles.paidTwice} role="note" aria-label="Paid twice">
                <p>Paid twice — refund {total} in CHIP</p>
                {cancelled ? null : refunding ? (
                  <span className={styles.confirm} role="group" aria-label="Confirm the second payment was refunded">
                    Marked the second payment refunded?
                    <button type="button" data-tone="merah" disabled={busy} onClick={() => void run('refunded', `#${order.number}: second payment marked refunded.`)}>
                      Yes, refunded
                    </button>
                    <button type="button" disabled={busy} onClick={() => setRefunding(false)}>
                      Keep
                    </button>
                  </span>
                ) : (
                  <span className={styles.refundAsk}>
                    <span>You owe {total}. Refund it in CHIP, then mark it refunded.</span>
                    <button type="button" className={styles.outline} disabled={busy} onClick={() => setRefunding(true)}>
                      Mark refunded
                    </button>
                  </span>
                )}
              </div>
            ) : paidTwice && !(cancelled && order.refundedAt) ? (
              // Once a cancelled order is refunded, its Refunded badge says it all.
              <p className={styles.refundedQuiet}>Second payment refunded</p>
            ) : null}
          </section>

          {hasDigital ? <SentByEmail order={order} first={first} when={when} act={act} say={say} onChanged={onChanged} /> : null}

          {digitalOnly && order.note ? (
            <section className={styles.card} aria-label="Note">
              <div className={styles.note}>
                <b>Note from {first}</b>
                {order.note}
              </div>
            </section>
          ) : null}

          {digitalOnly ? null : <section className={styles.card} aria-labelledby="order-getting">
            <h3 className={styles.cardTitle} id="order-getting">
              Getting it to them
            </h3>
            <div className={styles.kv}>
              <span className={styles.kvIcon} data-method={order.method} aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d={order.method === 'PICKUP' ? PIN : VAN} />
                </svg>
              </span>
              <span>
                <b>
                  {order.method === null ? null : `${order.method === 'PICKUP' ? 'Pickup' : 'Delivery'} · ${dayLabel(order.day)}`}
                </b>
                {(order.method === 'PICKUP' ? pickupNote : order.address) ? <span>{order.method === 'PICKUP' ? pickupNote : order.address}</span> : null}
              </span>
            </div>
            {order.note ? (
              <div className={styles.note}>
                <b>Note from {first}</b>
                {order.note}
              </div>
            ) : null}
          </section>}
        </div>
      </div>

      {zoom && order.receiptUrl ? (
        <div className={styles.zoom} role="dialog" aria-modal="true" aria-label="Receipt" onClick={() => setZoom(false)}>
          <img className={styles.zoomImage} src={order.receiptUrl} alt={`Receipt for order #${order.number}`} />
          <button ref={closeRef} type="button" className={styles.zoomClose} aria-label="Close" onClick={() => setZoom(false)}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d={CROSS} />
            </svg>
          </button>
        </div>
      ) : null}
    </div>
  );
}
