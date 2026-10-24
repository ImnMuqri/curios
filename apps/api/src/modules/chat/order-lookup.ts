import { normalizeClaim } from '@curios/core';
import { digitalFacts, type DigitalDelivery, type ItemKind } from '@curios/core/digital';
import { customerSteps, isOrderCodeShape, orderView, type OrderStatus } from '@curios/core/orders';
import type { Prisma, PrismaClient } from '@curios/db';

/**
 * "Where is my order 7Q4M?" (Public board, route `ask`). Answered here, from
 * the order itself, before any model call: the model never sees an order,
 * and a lookup costs the owner nothing.
 *
 * The code is not a secret on its own, so the chat asks for the last 4
 * digits of the WhatsApp number on the order first. One try per mention of
 * the code: a wrong answer forgets the order, so guessing means naming the
 * code again every time, and the chat's per-IP limits bound that.
 */

/** The Public board's `ocard`, as the chat's `order` event carries it. */
export interface OrderCard {
  number: number;
  code: string;
  /** The card's headline. */
  status: string;
  /** The order page's own status words. */
  pill: string;
  /** The pill's colour, as the order page names it. */
  tone: 'wait' | 'check' | 'ok' | 'stop' | 'quiet';
  steps: { placed: boolean; paid: boolean; ready: boolean; done: boolean };
  /** "1× Kek coklat moist 2kg, 1× Kek batik". */
  summary: string;
  /** "Pickup · Sat 17 Oct". */
  when: string;
  totalCents: number;
  /**
   * In place of the board's "Pay now" / "Open order page" button: the chat
   * cannot know the order link (only its hash is stored), so it says where
   * the details are instead.
   */
  note: string;
}

/** The words a message about an order uses. */
const ORDER_WORD = /^(order|pesanan|tempahan|status)$/;

function words(text: string): string[] {
  return text.split(/[^A-Za-z0-9]+/).filter(Boolean);
}

/**
 * Every word of a message that could be an order code, upper-cased, once
 * each, in order: four alphabet characters with a digit and a letter, the
 * only shape `orderCode` makes ("7Q4M", "yva4"). A word with no digit is
 * never a code -- MANA, SAYA, CAKE are just words -- so an everyday message
 * always reaches the model, whose prompt asks for the code.
 */
export function orderCodeCandidates(text: string): string[] {
  const found = words(text)
    .filter((word) => isOrderCodeShape(word))
    .map((word) => word.toUpperCase());
  return [...new Set(found)];
}

export function mentionsOrder(text: string): boolean {
  return words(text).some((word) => ORDER_WORD.test(word.toLowerCase()));
}

/**
 * The word a message names as an order code, for "I can’t find an order X",
 * or null. A candidate, but not one written like a price ("RM95") or a
 * quantity ("3pcs"): those are still matched against the page's real codes
 * (see `lookUpOrder`), but never answered as a missing order.
 */
export function findOrderCode(text: string): string | null {
  return words(text).find((word) => isOrderCodeShape(word) && !looksLikeAnAmount(word))?.toUpperCase() ?? null;
}

function looksLikeAnAmount(word: string): boolean {
  return /^rm\d+$/i.test(word) || /^\d+[a-z]+$/i.test(word);
}

/** The last 4 digits typed, however they are spaced, or null with fewer than 4. */
export function lastFourDigits(text: string): string | null {
  const digits = text.replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}

/**
 * Whether a message, while the chat waits for the digits, is the visitor's
 * answer: four digits or more, or nothing but digits and spacing ("678"). A
 * message with words and fewer digits ("berapa kek 2kg?") is a new question.
 */
function isDigitsAnswer(text: string): boolean {
  const digits = text.replace(/\D/g, '').length;
  return digits >= 4 || (digits > 0 && !/[\p{L}]/u.test(text));
}

const EN_DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const EN_MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface CardOrder {
  number: number;
  code: string;
  /** Null for a digital-only order. */
  method: 'PICKUP' | 'DELIVERY' | null;
  day: Date | null;
  totalCents: number;
  status: OrderStatus;
  receiptUploadedAt: Date | null;
  paidAt: Date | null;
  refundedAt: Date | null;
  lines: { itemName: string; optionLabel: string | null; quantity: number }[];
}

/**
 * The card. The pill's words mirror the order page's English
 * (apps/web/app/[handle]/shop/copy.ts, `statusWaiting` and on) and are chosen
 * the same way (order-view.tsx, `pill`): change one, change both.
 */
export function orderCard(order: CardOrder, name: string, now: Date): OrderCard {
  const day = order.day ? order.day.toISOString().slice(0, 10) : null;
  const view = orderView(order);
  const steps = customerSteps({ status: order.status, paidAt: order.paidAt, day }, now);

  const [status, pill, tone]: [string, string, OrderCard['tone']] = (() => {
    switch (view) {
      case 'awaitingPayment':
        return ['Waiting for your payment', 'Waiting for payment', 'wait'];
      case 'toCheck':
        return [`${name} is checking your receipt`, `Receipt sent · ${name} is checking`, 'check'];
      case 'paid':
      case 'paidOnline':
        return steps.ready
          ? [order.method === 'PICKUP' ? 'Ready for pickup' : 'Ready for delivery', 'Ready', 'ok']
          : [`Paid. ${name} is getting it ready`, `Paid · ${name} is getting it ready`, 'ok'];
      case 'completed':
        return ['All done', 'Done', 'ok'];
      case 'cancelled':
        return ['This order was cancelled', 'Cancelled', 'stop'];
      case 'refundOwed':
        return ['Cancelled. A refund is due', 'Cancelled · refund due', 'stop'];
      case 'refunded':
        return ['Cancelled and refunded', 'Refunded', 'quiet'];
    }
  })();

  const date = day === null ? null : new Date(`${day}T00:00:00Z`);
  const needsPay = view === 'awaitingPayment' || view === 'toCheck';

  return {
    number: order.number,
    code: order.code,
    status,
    pill,
    tone,
    steps,
    summary: order.lines
      .map((line) => `${line.quantity}× ${line.itemName}${line.optionLabel ? ` ${line.optionLabel}` : ''}`)
      .join(', '),
    // A digital-only order has no day to show yet.
    when: date === null ? '' : `${order.method === 'PICKUP' ? 'Pickup' : 'Delivery'} · ${EN_DAY[date.getUTCDay()]} ${date.getUTCDate()} ${EN_MONTH[date.getUTCMonth()]}`,
    totalCents: order.totalCents,
    note: needsPay ? 'Your order page has the full details and how to pay.' : 'Your order page has the full details.',
  };
}

const CARD_SELECT = {
  id: true,
  number: true,
  code: true,
  phone: true,
  method: true,
  day: true,
  totalCents: true,
  status: true,
  receiptUploadedAt: true,
  paidAt: true,
  refundedAt: true,
  lines: { orderBy: { position: 'asc' }, select: { itemName: true, optionLabel: true, quantity: true } },
} satisfies Prisma.OrderSelect;

export interface LookupTurn {
  text: string;
  card?: OrderCard;
  /** What the conversation waits on after this turn. */
  pendingOrderId: string | null;
}

/**
 * This message's lookup turn, or null when it is not one and the chat
 * answers it as usual. Reads only; the caller writes `pendingOrderId`.
 */
export async function lookUpOrder(
  prisma: PrismaClient,
  page: { id: string; displayName: string },
  pendingOrderId: string | null,
  text: string,
  now = new Date(),
): Promise<LookupTurn | null> {
  if (pendingOrderId && isDigitsAnswer(text)) {
    const pending = await prisma.order.findFirst({ where: { id: pendingOrderId, pageId: page.id }, select: CARD_SELECT });
    if (pending) {
      const typed = lastFourDigits(text);
      if (typed !== null && pending.phone.replace(/\D/g, '').endsWith(typed)) {
        return { text: `Thanks. Here’s order ${pending.code}:`, card: orderCard(pending, page.displayName, now), pendingOrderId: null };
      }
      return {
        text: `Those digits don’t match the number on order ${pending.code}. Try again, or message ${page.displayName} on WhatsApp.`,
        pendingOrderId: null,
      };
    }
  }

  // Any code-shaped word that is one of this page's codes, so "yva4?" is
  // found without the word "order"; a code of another page is never matched.
  const candidates = orderCodeCandidates(text);
  if (candidates.length > 0) {
    const orders = await prisma.order.findMany({
      where: { pageId: page.id, code: { in: candidates } },
      select: { id: true, code: true },
    });
    const found = candidates.map((code) => orders.find((o) => o.code === code)).find(Boolean);
    if (found) {
      return {
        text: `Found order ${found.code}. To keep it private, what are the last 4 digits of the WhatsApp number on it?`,
        pendingOrderId: found.id,
      };
    }
  }

  const code = findOrderCode(text);
  if (code && mentionsOrder(text)) {
    return { text: `I can’t find an order ${code} with this shop. Check the code on your order page.`, pendingOrderId: null };
  }
  return null;
}

/** What the chat shows under an answer that names a product: one card, for the first item named. */
export interface ProductCard {
  itemId: string;
  slug: string;
  name: string;
  fromPriceCents: number | null;
  photoUrl: string | null;
  firstOptionId: string | null;
  /** What the card's button does: add it, open its page to pick a class time first, or nothing (sold out). */
  buy: 'add' | 'pick' | 'soldOut';
}

interface CardItem {
  id: string;
  name: string;
  slug: string;
  priceCents: number | null;
  photoKey: string | null;
  options: { id: string; priceCents: number }[];
  /** Digital stock, as the shop reads it; absent reads as a physical item. */
  kind?: ItemKind;
  delivery?: DigitalDelivery | null;
  accessUrl?: string | null;
  files?: { name: string; contentType: string }[];
  sessions?: { id: string; startsAt: Date; seats: number; bookings: { seats: number }[] }[];
  _count?: { codes: number };
}

/**
 * The item of an open shop an answer names first: whole names, matched on
 * normalised text (capitals and punctuation folded, as a wording is). At most
 * one card. `storageBase` is STORAGE_PUBLIC_URL, joined to the photo key as
 * every other public item photo is.
 */
export function productCard(answer: string, items: CardItem[], storageBase: string | null, now = new Date()): ProductCard | null {
  const said = ` ${normalizeClaim(answer)} `;
  let best: { item: CardItem; at: number } | null = null;
  for (const item of items) {
    const name = normalizeClaim(item.name);
    const at = name ? said.indexOf(` ${name} `) : -1;
    if (at >= 0 && (best === null || at < best.at)) best = { item, at };
  }
  if (!best) return null;
  const { item } = best;
  const prices = item.options.map((option) => option.priceCents);
  const facts = digitalFacts(
    {
      kind: item.kind ?? 'PHYSICAL',
      delivery: item.delivery ?? null,
      accessUrl: item.accessUrl ?? null,
      files: item.files ?? [],
      codesLeft: item._count?.codes ?? 0,
      sessions: (item.sessions ?? []).map((s) => ({ id: s.id, startsAt: s.startsAt, seats: s.seats, booked: s.bookings.reduce((n, b) => n + b.seats, 0) })),
    },
    now,
  );
  return {
    itemId: item.id,
    slug: item.slug,
    name: item.name,
    fromPriceCents: prices.length > 0 ? Math.min(...prices) : item.priceCents,
    photoUrl: item.photoKey && storageBase ? `${storageBase.replace(/\/+$/, '')}/${item.photoKey}` : null,
    firstOptionId: item.options[0]?.id ?? null,
    buy: facts.soldOut ? 'soldOut' : facts.delivery === 'SESSION' ? 'pick' : 'add',
  };
}
