/**
 * The order rules that a browser and the API must agree on.
 *
 * Imports nothing, like `store.ts`, so a client component can load it by its
 * subpath without dragging the rest of the package into the bundle.
 */

/** Mirrors the Prisma enum; defined here so this module stays import-free. */
export type OrderStatus = 'PLACED' | 'PAID' | 'COMPLETED' | 'CANCELLED';

/**
 * No 0/O/1/I/L, so a code read aloud or squinted at on a phone is not
 * mistaken. It is what a customer says to the chat, never a secret on its own.
 */
export const ORDER_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export function orderCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < 4; i++) {
    // Clamped so a `random()` that returns exactly 1 cannot index past the end.
    const index = Math.min(
      ORDER_CODE_ALPHABET.length - 1,
      Math.floor(random() * ORDER_CODE_ALPHABET.length),
    );
    code += ORDER_CODE_ALPHABET[index];
  }
  return code;
}

export const ORDER_DAYS_AHEAD = 60;
export const NAME_MAX = 60;
export const ADDRESS_MAX = 240;
export const ORDER_NOTE_MAX = 280;
export const RECEIPT_MAX_BYTES = 5_242_880;

/** Today's calendar day in Malaysia, `YYYY-MM-DD`. */
export function malaysiaToday(now: Date): string {
  // The en-CA locale formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(now);
}

interface DaySettings {
  now: Date;
  minNoticeDays: number;
  /** Weekdays the shop is closed, 0 = Sunday. */
  closedDays: number[];
}

const DAY_MS = 86_400_000;

function dayToMs(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

function addDays(day: string, days: number): string {
  return new Date(dayToMs(day) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Whether a customer may ask for this day. Days are calendar days in
 * Malaysia and are compared as strings, so no clock offset can move one.
 */
export function isOrderDay(day: string, s: DaySettings): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const ms = dayToMs(day);
  // Rejects 2026-02-31 and its kind, which a date parser would roll over.
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== day) return false;

  const today = malaysiaToday(s.now);
  if (day < addDays(today, s.minNoticeDays)) return false;
  if (day > addDays(today, ORDER_DAYS_AHEAD)) return false;
  return !s.closedDays.includes(new Date(ms).getUTCDay());
}

/** The next `count` days `isOrderDay` accepts, in order. */
export function openDays(s: DaySettings, count: number): string[] {
  const today = malaysiaToday(s.now);
  const days: string[] = [];
  for (let i = 0; i <= ORDER_DAYS_AHEAD && days.length < count; i++) {
    const day = addDays(today, i);
    if (isOrderDay(day, s)) days.push(day);
  }
  return days;
}

/**
 * Items plus delivery, in integer sen. Only a flat fee on a delivery adds to
 * the total: a rider is paid by the customer directly, and pickup costs
 * nothing. The server computes this; a client total is only ever compared.
 */
export function orderTotals(
  lines: { unitCents: number; quantity: number }[],
  delivery: {
    method: 'PICKUP' | 'DELIVERY';
    mode: 'NONE' | 'FLAT' | 'RIDER';
    feeCents: number | null;
  },
): { itemsCents: number; deliveryCents: number; totalCents: number } {
  const itemsCents = lines.reduce((sum, l) => sum + l.unitCents * l.quantity, 0);
  const deliveryCents =
    delivery.method === 'DELIVERY' && delivery.mode === 'FLAT' ? (delivery.feeCents ?? 0) : 0;
  return { itemsCents, deliveryCents, totalCents: itemsCents + deliveryCents };
}

export type OrderView =
  | 'awaitingPayment'
  | 'toCheck'
  | 'paid'
  | 'completed'
  | 'refundOwed'
  | 'refunded'
  | 'cancelled';

/**
 * The badge the Orders board shows. Refund owed and refunded are not
 * statuses: they are a cancelled order that had been paid, told apart by
 * whether the owner has marked the money back.
 */
export function orderView(o: {
  status: OrderStatus;
  receiptUploadedAt: Date | null;
  paidAt: Date | null;
  refundedAt: Date | null;
}): OrderView {
  switch (o.status) {
    case 'PLACED':
      return o.receiptUploadedAt !== null ? 'toCheck' : 'awaitingPayment';
    case 'PAID':
      return 'paid';
    case 'COMPLETED':
      return 'completed';
    case 'CANCELLED':
      if (o.paidAt === null) return 'cancelled';
      return o.refundedAt === null ? 'refundOwed' : 'refunded';
  }
}

/**
 * The customer's progress line. Ready lights once the order is paid and its
 * day (Malaysia) has come; a completed order is past ready, so it stays lit.
 */
export function customerSteps(
  o: { status: OrderStatus; paidAt: Date | null; day: string },
  now: Date,
): { placed: true; paid: boolean; ready: boolean; done: boolean } {
  const done = o.status === 'COMPLETED';
  const paid = o.status === 'PAID' || done;
  const ready = done || (o.status === 'PAID' && o.day <= malaysiaToday(now));
  return { placed: true, paid, ready, done };
}
