'use client';

import { useEffect, useRef, useState } from 'react';
import { customerSteps, orderView, type OrderView } from '@curios/core/orders';
import { pickupLine, windowLabel } from '@curios/core/pickup';
import { formatMalaysianPhone } from '@curios/core/phone';
import { formatRinggit } from '@curios/core/store';
import type { OwnerOrder } from '@curios/db-read';
import { ApiError } from '../../../lib/api.js';
import { Dialog } from '../_ui/dialog.js';
import inbox from '../_ui/inbox.module.css';
import { InlineConfirm } from '../_ui/inline-confirm.js';
import { failureText } from '../_ui/toast.js';
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
// Built once, not per call: the list formats a day for every order it shows.
const DAY_FORMAT = new Intl.DateTimeFormat('en-CA', { timeZone: KL });
const CLOCK_FORMAT = new Intl.DateTimeFormat('en-GB', { timeZone: KL, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const WEEKDAY_FORMAT = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: KL });
const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: KL });
const LABEL_FORMAT = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const dayOf = (date: Date) => DAY_FORMAT.format(date);

/** "10:02am", in Malaysia. */
function clock(date: Date): string {
  const parts = CLOCK_FORMAT.formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${hour % 12 || 12}:${minute}${hour < 12 ? 'am' : 'pm'}`;
}

/** "today, 10:02am", "yesterday, 9:15pm", "Tue, 2:31pm", "3 Oct, 11:00am": the board's way of saying when. */
export function orderWhen(date: Date, now: Date): string {
  const day = dayOf(date);
  if (day === dayOf(now)) return `today, ${clock(date)}`;
  if (day === dayOf(new Date(now.getTime() - DAY_MS))) return `yesterday, ${clock(date)}`;
  const format = now.getTime() - date.getTime() < 7 * DAY_MS ? WEEKDAY_FORMAT : DATE_FORMAT;
  return `${format.format(date)}, ${clock(date)}`;
}

/** "Sat 17 Oct", from the order's calendar day. */
export function dayLabel(day: string | null): string {
  if (day === null) return '';
  const parts = LABEL_FORMAT.formatToParts(new Date(`${day}T00:00:00Z`));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('weekday')} ${part('day')} ${part('month')}`;
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

export const itemCount = (order: OrderRow) => order.lines.reduce((sum, line) => sum + line.quantity, 0);

export const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** `orderView`, plus Sent: a digital-only order that has been delivered (the board's `view()` reads it as Sent, not Completed). */
export type OwnerView = OrderView | 'sent';

export function ownerView(order: OrderRow): OwnerView {
  const view = orderView(order);
  const delivered = view === 'paid' || view === 'paidOnline' || view === 'completed';
  return delivered && order.method === null && order.sentAt !== null ? 'sent' : view;
}

/** A tag's colour family in the inbox kit (inbox.module.css `.tag[data-tone]`); grey is the kit's plain tag. */
export type TagTone = 'ok' | 'wait' | 'red' | 'grey';

/** The board's tags by view (Dash.html `.li .tag`): green for paid and done, amber to check, red for money owed back. */
export const BADGES: Record<OwnerView, { label: string; tone: TagTone }> = {
  awaitingPayment: { label: 'Awaiting payment', tone: 'grey' },
  toCheck: { label: 'To check', tone: 'wait' },
  paid: { label: 'Paid', tone: 'ok' },
  paidOnline: { label: 'Paid online', tone: 'ok' },
  completed: { label: 'Completed', tone: 'ok' },
  // A digital-only order, delivered: nothing to make and nothing to complete, so Sent is where it ends.
  sent: { label: 'Sent', tone: 'ok' },
  refundOwed: { label: 'Refund owed', tone: 'red' },
  refunded: { label: 'Cancelled', tone: 'grey' },
  cancelled: { label: 'Cancelled', tone: 'grey' },
};

/** CHIP also took the money for an order paid another way, and the second payment is not back yet. */
export const owesSecond = (order: Pick<OrderRow, 'chipPaidTwiceAt' | 'secondRefundedAt'>) => order.chipPaidTwiceAt !== null && order.secondRefundedAt === null;

/**
 * The order's tag. Paid twice (red) stands over a live order's own tag while the second payment
 * is owed back; a cancelled one already says Refund owed. The detail spells two out in full.
 */
export function orderTag(order: OrderRow, where: 'list' | 'detail' = 'list'): { label: string; tone: TagTone } {
  const view = ownerView(order);
  if (owesSecond(order) && order.status !== 'CANCELLED') return { label: 'Paid twice', tone: 'red' };
  if (where === 'detail' && view === 'toCheck') return { label: 'Receipt to check', tone: 'wait' };
  if (where === 'detail' && view === 'refunded') return { label: 'Refunded', tone: 'grey' };
  return BADGES[view];
}

/** The customer's initial in a circle, tinted as the order's tag is. */
export function Initial({ order }: { order: OrderRow }) {
  const tone = orderTag(order).tone;
  return (
    <span className={inbox.av} data-tone={tone === 'grey' ? undefined : tone} aria-hidden="true">
      {order.customerName.trim().charAt(0).toUpperCase()}
    </span>
  );
}

/** A tag pill: the kit's `.tag`, its colour from the tone. */
export function Tag({ tag }: { tag: { label: string; tone: TagTone } }) {
  return (
    <span className={inbox.tag} data-tone={tag.tone === 'grey' ? undefined : tag.tone}>
      {tag.label}
    </span>
  );
}

const FILE = 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4';
const STEPS = ['Placed', 'Paid', 'Ready', 'Done'] as const;

type Ask = { button: string; action: OrderAction; toast: string };
type Confirming = 'not-received' | 'cancel' | 'second' | null;


/**
 * One order, as the calm board's detail card (Dash.html `.det.xd`): the order's number and when,
 * the customer, the tag, four quiet steps, the label and value rows, then whichever of the
 * receipt, the soft cards (sent by email, a voucher, a receipt not received), the paid-twice panel
 * and how it gets to them apply. Under them a one-line hint, the one move as a full-width pill,
 * WhatsApp, and the red moves that ask first (InlineConfirm, one open at a time).
 *
 * Renders the card's contents; the screen puts them in the kit's `.det`. The heading takes focus
 * (tabIndex -1) when a phone opens the order as its own view.
 */
export function OrderDetail({
  order,
  now,
  move,
  act,
  say,
  fail,
  onChanged,
}: {
  order: OrderRow;
  now: Date;
  move: OrderMove;
  /** The owner's moves on what was sent by email: new links, a new code, another time, the email again. */
  act: DigitalAct;
  /** The screen's toast, which outlives this panel: what happened. */
  say: (text: string) => void;
  /** The toast's error tone (no tick, role alert, stays): what failed, for every move in the card. */
  fail: (text: string) => void;
  /** After a move: read the server again, for the list and the figures. */
  onChanged: () => void;
}) {
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(false);
  const inFlight = useRef(false);
  const tile = useRef<HTMLButtonElement>(null);

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
  // A voucher took it to RM0: paid at once, with no receipt to wait for or check.
  const byVoucher = order.paidVia === 'VOUCHER' && order.paidAt !== null;
  // CHIP also took the money for an order paid another way: one of the two is owed back.
  const paidTwice = order.chipPaidTwiceAt !== null;
  const secondOwed = owesSecond(order);
  const notReceived = order.status === 'PLACED' && order.receiptRejectedAt !== null && !hasReceipt;
  const sendsMail = hasDigital && order.email !== null;

  // A fresh read of this order: whatever was in flight has landed, and its buttons are live again.
  useEffect(() => {
    inFlight.current = false;
    setBusy(false);
  }, [order]);

  // The board's four steps. Ready lights once it is paid and its day has come; a cancelled order keeps what it reached.
  const reached = customerSteps(order, now);
  const lit = cancelled
    ? [order.paidAt !== null, order.paidAt !== null, false, false]
    : [true, reached.paid, reached.ready || view === 'sent', reached.done || view === 'sent'];
  const lastLit = lit.lastIndexOf(true);

  // Label and value rows (Dash.html `.kv2`).
  const lineText = (line: OrderRow['lines'][number], one: boolean) =>
    `${line.quantity > 1 ? `${line.quantity}× ` : ''}${line.itemName}${line.optionLabel ? `${one ? ' · ' : ' '}${line.optionLabel}` : ''}`;
  const count = itemCount(order);
  const rows: [string, string][] = [[count === 1 ? 'Item' : 'Items', order.lines.map((line) => lineText(line, order.lines.length === 1)).join(' · ')]];
  if (order.discountCents > 0) {
    rows.push(['Subtotal', formatRinggit(order.itemsCents)]);
    rows.push(['Voucher', `${order.voucherLabel ?? 'Voucher'} · −${formatRinggit(order.discountCents)}`]);
  }
  rows.push(['Total', order.deliveryCents > 0 ? `${formatRinggit(order.totalCents - order.deliveryCents)} + ${formatRinggit(order.deliveryCents)} delivery` : total]);
  if (order.paidAt !== null && !byVoucher) {
    const paidBy =
      order.paidVia === 'CHIP'
        ? [order.paidMethodLabel ?? 'CHIP', order.paidRef ? `Ref ${order.paidRef}` : null].filter(Boolean).join(' · ')
        : order.paidVia === 'RECEIPT' || (order.paidVia === null && hasReceipt)
          ? 'Receipt · checked by you'
          : 'Marked paid by you';
    rows.push(['Paid by', paidBy]);
  }
  // How it gets to them: a block with the address and the note when there is either, else one row.
  const placeAddress = order.method === 'PICKUP' ? order.pickupPlaceAddress : order.method === 'DELIVERY' ? order.address : null;
  const methodLine =
    order.method === null ? null : (pickupLine({ ...order, dayLabel: dayLabel(order.day) }) ?? `Delivery · ${dayLabel(order.day)}`);
  const showGo = order.method !== null && (placeAddress !== null || order.note !== null);
  if (order.method !== null && !showGo) {
    rows.push(
      order.method === 'PICKUP'
        ? [
            'Pickup',
            [order.pickupPlaceName, [dayLabel(order.day), order.pickupFrom !== null && order.pickupTo !== null ? windowLabel(order.pickupFrom, order.pickupTo) : null].filter(Boolean).join(', ')]
              .filter(Boolean)
              .join(' · '),
          ]
        : ['Delivery', dayLabel(order.day)],
    );
  }
  if (cancelled) rows.push(['Cancelled', `${capital(when(order.cancelledAt ?? order.createdAt))}${order.paidAt === null ? ', before payment' : ''}`]);
  else rows.push(['WhatsApp', formatMalaysianPhone(order.phone)]);

  // The one move, in a full-width pill.
  const paidToast = digitalOnly ? `#${order.number} paid. It’s on its way to ${first}’s email.` : `#${order.number} marked paid. The digital items are on their way to ${first}’s email.`;
  let ask: Ask | null = null;
  if (view === 'toCheck')
    ask = sendsMail
      ? { button: 'Mark paid and send', action: 'paid', toast: paidToast }
      : { button: 'Mark paid', action: 'paid', toast: `#${order.number} marked paid. ${first} can see it on their order page.` };
  else if (view === 'awaitingPayment')
    ask = sendsMail ? { button: 'Mark paid and send', action: 'paid', toast: paidToast } : { button: 'Mark paid', action: 'paid', toast: `#${order.number} marked paid.` };
  // A digital-only order has nothing to make: once paid it is sent, and Sent is where it ends.
  else if ((view === 'paid' || view === 'paidOnline') && !digitalOnly) ask = { button: 'Mark completed', action: 'completed', toast: `#${order.number} completed. Nice one.` };
  else if (view === 'refundOwed') ask = { button: 'Mark refunded', action: 'refunded', toast: `#${order.number} marked refunded.` };

  // The quiet line above it (Dash.html `.xhint`).
  const only = order.lines.length === 1 ? order.lines[0]!.itemName.toLowerCase() : 'items';
  const elsewhere = sendsMail
    ? digitalOnly
      ? `Paid some other way? Mark it paid and their ${only} goes to ${order.email}.`
      : `Paid some other way? Mark it paid and their digital items go to ${order.email}.`
    : 'Paid some other way? You can still mark it paid.';
  let hint: string | null = null;
  if (view === 'awaitingPayment') hint = notReceived ? elsewhere : `No receipt was uploaded. ${elsewhere}`;
  else if (view === 'paidOnline' && !paidTwice) hint = 'Paid through CHIP, so there’s nothing to check.';
  // A voucher order says how it was paid in its soft card, and the board gives it no hint.
  else if (view === 'paid' && !digitalOnly && !byVoucher) hint = `Paid. Ready on ${dayLabel(order.day)}. Mark it completed once ${first} has it.`;
  else if (view === 'refundOwed') hint = secondOwed ? 'Send it back yourself and refund the CHIP payment too, then mark it refunded.' : 'Send it back yourself, then mark it refunded.';
  else if (view === 'cancelled') hint = 'Nothing was paid, so nothing is owed.';

  // Where it was before: beside a next move, so never on a digital-only order that is paid (nothing left to do).
  const canCancel = (order.status === 'PLACED' || order.status === 'PAID') && ask !== null;
  const cancelQuestion =
    order.status === 'PAID' && order.totalCents > 0
      ? `Cancel #${order.number}? You will owe ${first} ${total}.`
      : view === 'toCheck'
        ? // Not marked paid, so cancelling tracks no refund: say how to make it.
          `Cancel #${order.number}? ${first}’s receipt is in. If the money arrived, mark it paid first, so cancelling records the refund you owe.`
        : `Cancel #${order.number}?`;

  /** Sends the move. Throws on failure (an InlineConfirm stays open); stays busy until the server's read arrives. */
  async function perform(action: OrderAction, toast: string) {
    // Another move is still saving: say so, and leave a confirm open (it treats a throw as not done).
    if (inFlight.current) throw new Error('One moment: the last change is still saving.');
    inFlight.current = true;
    setBusy(true);
    try {
      await move(order.id, action);
    } catch (failure) {
      inFlight.current = false;
      setBusy(false);
      // Gone, or moved on elsewhere (another tab): read it again, as the words say.
      if (failure instanceof ApiError && (failure.status === 404 || failure.status === 409)) onChanged();
      throw failure;
    }
    setConfirming(null);
    say(toast);
    onChanged();
  }
  const failed = (failure: unknown) => fail(failureText(failure));
  const openAs = (which: Exclude<Confirming, null>) => (open: boolean) => setConfirming(open ? which : null);

  const isPdf = order.receiptType === 'application/pdf';
  const receiptTile = (small: string) => {
    const body = (
      <>
        <span className={styles.receiptThumb} data-pdf={isPdf || !order.receiptUrl || undefined} aria-hidden="true">
          {order.receiptUrl && !isPdf ? (
            <img src={order.receiptUrl} alt="" />
          ) : (
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path d={FILE} />
            </svg>
          )}
        </span>
        <span className={styles.receiptText}>
          <b>Receipt</b>
          <small>{small}</small>
        </span>
      </>
    );
    if (order.receiptUrl && isPdf)
      return (
        <a className={styles.receipt} href={order.receiptUrl} target="_blank" rel="noopener noreferrer">
          {body}
        </a>
      );
    if (order.receiptUrl)
      return (
        <button ref={tile} type="button" className={styles.receipt} onClick={() => setZoom(true)}>
          {body}
        </button>
      );
    return <div className={styles.receipt}>{body}</div>;
  };
  const uploaded = order.receiptUploadedAt ? `Uploaded ${when(order.receiptUploadedAt)}` : 'Uploaded';
  const opens = order.receiptUrl ? (isPdf ? ' · opens the PDF' : ' · tap to open') : '';

  return (
    <>
      <p className={inbox.k}>
        Order #{order.number} · {capital(when(order.createdAt))}
      </p>
      <h2 className={styles.name} tabIndex={-1} data-detail-heading="">
        {order.customerName}
      </h2>
      <Tag tag={orderTag(order, 'detail')} />

      <ol className={styles.steps} aria-label="Order progress">
        {STEPS.map((label, i) => (
          <li key={label} data-on={lit[i] || undefined} aria-current={i === lastLit && !cancelled ? 'step' : undefined}>
            {label}
          </li>
        ))}
      </ol>

      <dl className={inbox.kv2}>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      {hasReceipt && !secondOwed && (!online || paidTwice) ? <div className={styles.block}>{receiptTile(`${uploaded}${opens}`)}</div> : null}

      {hasDigital ? <SentByEmail order={order} first={first} when={when} act={act} say={say} fail={fail} onChanged={onChanged} /> : null}

      {byVoucher ? (
        <div className={styles.soft}>
          <b>Paid with a voucher</b>
          <small>The voucher took the whole order off, so there is no receipt to check.</small>
        </div>
      ) : null}

      {notReceived ? (
        <div className={styles.soft} data-tone="warn">
          <b>Receipt not received</b>
          <small>You marked the receipt not received. {first}’s order page asks them to pay again.</small>
        </div>
      ) : null}

      {/* CHIP took the money on top of the QR or a hand-marked payment (DEVIATIONS 187). */}
      {secondOwed ? (
        <section className={styles.twice} aria-label="Paid twice">
          <b>Paid twice</b>
          <p>
            {online
              ? `Confirmed by the bank through CHIP, and a receipt for a transfer came in too. Send the second ${total} back to ${first}, then mark it refunded.`
              : `It was paid, and CHIP took ${total} again too. Refund the second ${total} in CHIP, then mark it refunded.`}
          </p>
          {/* CHIP took the second payment: the receipt here is the first one's. */}
          {hasReceipt ? receiptTile(`${online ? '' : 'First payment · '}${uploaded}${opens}`) : null}
          {/* A cancelled order's Mark refunded below takes both payments back. */}
          {cancelled ? null : (
            <div className={styles.twiceConfirm}>
              <InlineConfirm
                tone="quiet"
                trigger="Mark refunded"
                question="Marked the second payment refunded?"
                yes="Yes, refunded"
                no="Not yet"
                open={confirming === 'second'}
                onOpenChange={openAs('second')}
                onYes={() => perform('refunded', `#${order.number}: second payment marked refunded.`)}
                onError={failed}
              />
            </div>
          )}
        </section>
      ) : paidTwice && !(cancelled && order.refundedAt) ? (
        // Once a cancelled order is refunded, its Refunded tag says it all.
        <p className={styles.hint}>Second payment refunded</p>
      ) : null}

      {showGo || (digitalOnly && order.note) ? (
        <div className={styles.go}>
          {showGo ? (
            <>
              <p className={styles.lab}>Getting it to them</p>
              <div className={styles.goBox}>
                <b>{methodLine}</b>
                {placeAddress ? <span>{placeAddress}</span> : null}
              </div>
            </>
          ) : null}
          {order.note ? (
            <div className={styles.note}>
              <small>Note from {first}</small>
              {order.note}
            </div>
          ) : null}
        </div>
      ) : null}

      {hint || ask ? (
        <section className={styles.next} aria-label={ask ? 'What to do next' : undefined}>
          {hint ? <p className={styles.hint}>{hint}</p> : null}
          {ask ? (
            <button type="button" className={styles.primary} disabled={busy} onClick={() => void perform(ask.action, ask.toast).catch(failed)}>
              {ask.button}
            </button>
          ) : null}
        </section>
      ) : null}

      <a className={styles.whatsapp} data-alone={ask ? undefined : ''} href={`https://wa.me/${waNumber(order.phone)}`} target="_blank" rel="noopener noreferrer">
        WhatsApp {first}
      </a>

      {view === 'toCheck' ? (
        <InlineConfirm
          trigger="Not received"
          question={`Mark the receipt not received? ${first} will be asked to pay again.`}
          yes="Yes, not received"
          no="Keep it"
          open={confirming === 'not-received'}
          onOpenChange={openAs('not-received')}
          onYes={() => perform('not-received', `#${order.number}: receipt marked not received. ${first} will be asked to pay again.`)}
          onError={failed}
        />
      ) : null}
      {canCancel ? (
        <InlineConfirm
          trigger="Cancel order"
          question={cancelQuestion}
          yes="Yes, cancel"
          no="Keep it"
          open={confirming === 'cancel'}
          onOpenChange={openAs('cancel')}
          onYes={() => perform('cancel', `#${order.number} cancelled.${order.paidAt && order.totalCents > 0 ? ' A refund is owed.' : ''}`)}
          onError={failed}
        />
      ) : null}

      {order.receiptUrl && !isPdf ? (
        <Dialog open={zoom} onClose={() => setZoom(false)} title={`Receipt for order #${order.number}`} returnFocusTo={tile}>
          {zoom ? (
            <div className={styles.receiptBig}>
              <img src={order.receiptUrl} alt={`Receipt for order #${order.number}`} />
            </div>
          ) : null}
          {view === 'toCheck' ? <p className={styles.dialogHint}>Make sure {total} reached your account before you mark it paid.</p> : null}
        </Dialog>
      ) : null}
    </>
  );
}
