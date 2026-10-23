import { canTakeOrders, hashSessionValue } from '@curios/core';
import { malaysiaToday } from '@curios/core/orders';
import type { HeadingFont, PageBackground, PageStyle } from '@curios/core/bento';
import type { DeliveryMode } from '@curios/core/store';
import type { Prisma } from '@prisma/client';
import { prismaRead } from './client.js';
import { getPublicShop, type PublicShop, type ShopItem } from './shop.query.js';

type OrderStatus = 'PLACED' | 'PAID' | 'COMPLETED' | 'CANCELLED';
type OrderMethod = 'PICKUP' | 'DELIVERY';

export interface OwnerOrder {
  id: string;
  number: number;
  code: string;
  customerName: string;
  phone: string;
  method: OrderMethod;
  /** The calendar day (Malaysia), `YYYY-MM-DD`. */
  day: string;
  address: string | null;
  note: string | null;
  itemsCents: number;
  deliveryCents: number;
  totalCents: number;
  status: OrderStatus;
  /** The storage key; the web layer joins it onto STORAGE_PUBLIC_URL, as avatars are. */
  receiptKey: string | null;
  receiptType: string | null;
  receiptUploadedAt: Date | null;
  receiptRejectedAt: Date | null;
  paidAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  refundedAt: Date | null;
  /** How it was paid, and for CHIP how and by what reference ("FPX · Maybank2u"): Orders says so. */
  paidVia: 'RECEIPT' | 'MANUAL' | 'CHIP' | null;
  paidMethodLabel: string | null;
  paidRef: string | null;
  /** When CHIP took a payment on top of one made another way (QR, by hand): one is owed back. */
  chipPaidTwiceAt: Date | null;
  createdAt: Date;
  lines: { itemName: string; optionLabel: string | null; unitPriceCents: number; quantity: number; photoKey: string | null }[];
}

const dayText = (day: Date): string => day.toISOString().slice(0, 10);

/**
 * What still needs the owner: a receipt to check or a payment to wait for
 * (PLACED), something to make (PAID), money to send back (CANCELLED after it
 * was paid, not yet refunded). The same rules as the figures and the nav
 * badge, so nothing they count can fall off the list.
 */
const NEEDS_OWNER = {
  OR: [{ status: { in: ['PLACED' as const, 'PAID' as const] } }, { status: 'CANCELLED' as const, paidAt: { not: null }, refundedAt: null }, { chipPaidTwiceAt: { not: null }, refundedAt: null }],
};

const newestFirst = (a: { createdAt: Date; number: number }, b: { createdAt: Date; number: number }) =>
  b.createdAt.getTime() - a.createdAt.getTime() || b.number - a.number;

/**
 * This owner's orders, newest first, scoped through the page's owner inside
 * the query: an order carries a name, a phone and an address.
 *
 * Every order that still needs the owner, however old, and the newest
 * `limit` (at most 100) of the rest. Capping the whole list would drop an old
 * receipt to check off the screen while the figures and the badge still
 * count it.
 */
export async function getOwnerOrders(accountId: string, options: { limit?: number } = {}): Promise<OwnerOrder[]> {
  const scope = { page: { accountId } };
  const [open, done] = await Promise.all([
    readOwnerOrders({ AND: [scope, NEEDS_OWNER] }),
    readOwnerOrders({ AND: [scope, { NOT: NEEDS_OWNER }] }, Math.min(options.limit ?? 50, 100)),
  ]);
  // The two halves cannot overlap (one is the other's NOT); merged back into one newest-first list.
  return [...open, ...done].sort(newestFirst);
}

async function readOwnerOrders(where: Prisma.OrderWhereInput, take?: number): Promise<OwnerOrder[]> {
  const rows = await prismaRead.order.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { number: 'desc' }],
    ...(take === undefined ? {} : { take }),
    select: {
      id: true,
      number: true,
      code: true,
      customerName: true,
      phone: true,
      method: true,
      day: true,
      address: true,
      note: true,
      itemsCents: true,
      deliveryCents: true,
      totalCents: true,
      status: true,
      receiptKey: true,
      receiptType: true,
      receiptUploadedAt: true,
      receiptRejectedAt: true,
      paidAt: true,
      completedAt: true,
      cancelledAt: true,
      refundedAt: true,
      paidVia: true,
      paidMethodLabel: true,
      paidRef: true,
      chipPaidTwiceAt: true,
      createdAt: true,
      lines: {
        orderBy: { position: 'asc' },
        select: {
          itemName: true,
          optionLabel: true,
          unitPriceCents: true,
          quantity: true,
          item: { select: { photoKey: true } },
        },
      },
    },
  });
  return rows.map(({ day, lines, ...order }) => ({
    ...order,
    day: dayText(day),
    lines: lines.map(({ item, ...line }) => ({ ...line, photoKey: item?.photoKey ?? null })),
  }));
}

export interface OrderStats {
  /** PLACED with a receipt in: waiting for the owner to look. */
  toCheck: number;
  /** PAID: to be made. */
  toMake: number;
  paidThisWeekCents: number;
  /** Paid sen on each of the last 7 Malaysian days, oldest first, today last. */
  week: number[];
}

const DAY_MS = 86_400_000;
/** Malaysia is UTC+8 all year. */
const MALAYSIA_OFFSET_MS = 8 * 3_600_000;

/** The board's three figures. An order counts on the Malaysian day of its `paidAt`; a cancelled one not at all. */
export async function getOrderStats(accountId: string, now = new Date()): Promise<OrderStats> {
  const scope = { page: { accountId } };
  const today = Date.parse(`${malaysiaToday(now)}T00:00:00Z`);
  const first = today - 6 * DAY_MS;
  const [toCheck, toMake, paid] = await Promise.all([
    prismaRead.order.count({ where: { ...scope, status: 'PLACED', receiptUploadedAt: { not: null } } }),
    prismaRead.order.count({ where: { ...scope, status: 'PAID' } }),
    prismaRead.order.findMany({
      where: {
        ...scope,
        status: { in: ['PAID', 'COMPLETED'] },
        paidAt: { gte: new Date(first - MALAYSIA_OFFSET_MS), lt: new Date(today + DAY_MS - MALAYSIA_OFFSET_MS) },
      },
      select: { totalCents: true, paidAt: true },
    }),
  ]);
  const week = [0, 0, 0, 0, 0, 0, 0];
  for (const order of paid) {
    if (!order.paidAt) continue;
    const slot = Math.floor((order.paidAt.getTime() + MALAYSIA_OFFSET_MS - first) / DAY_MS);
    if (slot >= 0 && slot < 7) week[slot]! += order.totalCents;
  }
  return { toCheck, toMake, paidThisWeekCents: week.reduce((a, b) => a + b, 0), week };
}

export interface PublicOrder {
  id: string;
  number: number;
  code: string;
  customerName: string;
  phone: string;
  method: OrderMethod;
  day: string;
  address: string | null;
  note: string | null;
  itemsCents: number;
  deliveryCents: number;
  totalCents: number;
  status: OrderStatus;
  receiptKey: string | null;
  receiptType: string | null;
  receiptUploadedAt: Date | null;
  receiptRejectedAt: Date | null;
  paidAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  refundedAt: Date | null;
  /** How it was paid; null until it is. */
  paidVia: 'RECEIPT' | 'MANUAL' | 'CHIP' | null;
  /** How CHIP says it was paid ("FPX · Maybank2u") and CHIP's reference, for the Paid row. */
  paidMethodLabel: string | null;
  paidRef: string | null;
  /** Placed, with a CHIP purchase started for it: the order page checks it. The purchase id itself stays on the server. */
  chipPending: boolean;
  createdAt: Date;
  lines: { itemName: string; optionLabel: string | null; unitPriceCents: number; quantity: number; photoKey: string | null }[];
  page: {
    handle: string;
    displayName: string;
    language: string;
    style: PageStyle;
    accentColor: string;
    headingFont: HeadingFont;
    avatarKey: string | null;
    coverKey: string | null;
    background: PageBackground;
    backgroundColor: string | null;
    /** The page's links, for `whatsappNumber(links)` to find the owner's WhatsApp. */
    links: { label: string; url: string }[];
    paymentQrKey: string | null;
    bankName: string | null;
    bankAccountName: string | null;
    bankAccountNumber: string | null;
    /** What the shop's CHIP account takes, for the order page's "Try paying again"; null when nothing (as getCheckout's). */
    chipMethods: string[] | null;
  };
}

/** The methods a shop's CHIP account takes, or null: none connected, its key refused, or a test key in production. */
function usableChipMethods(chip: { methods: string[]; isTest: boolean; lastErrorAt: Date | null } | null): string[] | null {
  return chip && chip.lastErrorAt === null && !(chip.isTest && process.env.NODE_ENV === 'production') ? chip.methods : null;
}

/**
 * The order page's data, found by the link's secret. Only its hash is stored,
 * so the lookup hashes what it is given. Null for an unknown token.
 */
export async function getOrderByToken(token: string): Promise<PublicOrder | null> {
  const row = await prismaRead.order.findUnique({
    where: { tokenHash: hashSessionValue(token) },
    select: {
      id: true,
      number: true,
      code: true,
      customerName: true,
      phone: true,
      method: true,
      day: true,
      address: true,
      note: true,
      itemsCents: true,
      deliveryCents: true,
      totalCents: true,
      status: true,
      receiptKey: true,
      receiptType: true,
      receiptUploadedAt: true,
      receiptRejectedAt: true,
      paidAt: true,
      completedAt: true,
      cancelledAt: true,
      refundedAt: true,
      paidVia: true,
      paidMethodLabel: true,
      paidRef: true,
      chipPurchaseId: true,
      createdAt: true,
      lines: {
        orderBy: { position: 'asc' },
        select: { itemName: true, optionLabel: true, unitPriceCents: true, quantity: true, item: { select: { photoKey: true } } },
      },
      page: {
        select: {
          handle: true,
          displayName: true,
          language: true,
          style: true,
          accentColor: true,
          headingFont: true,
          avatarKey: true,
          coverKey: true,
          background: true,
          backgroundColor: true,
          links: { orderBy: { position: 'asc' }, select: { label: true, url: true } },
          paymentQrKey: true,
          bankName: true,
          bankAccountName: true,
          bankAccountNumber: true,
          // Never the sealed key: the read-only role cannot read that column at all.
          paymentAccount: { select: { methods: true, isTest: true, lastErrorAt: true } },
        },
      },
    },
  });
  if (!row) return null;
  const {
    day,
    lines,
    chipPurchaseId,
    page: { paymentAccount, ...page },
    ...order
  } = row;
  return {
    ...order,
    page: { ...page, chipMethods: usableChipMethods(paymentAccount) },
    chipPending: order.status === 'PLACED' && chipPurchaseId !== null,
    day: dayText(day),
    lines: lines.map(({ item, ...line }) => ({ ...line, photoKey: item?.photoKey ?? null })),
  };
}

export interface Checkout extends PublicShop {
  pickupEnabled: boolean;
  pickupNote: string | null;
  deliveryMode: DeliveryMode;
  deliveryFeeCents: number | null;
  deliveryNote: string | null;
  minNoticeDays: number;
  closedDays: number[];
  /** `canTakeOrders` of @curios/core, the one rule the shop, API, Alerts and Billing share. */
  canTakeOrders: boolean;
  /** The owner's QR or full bank details: the "DuitNow QR" choice. */
  payByQr: boolean;
  /** The owner's own DuitNow QR, which the choice is named after when CHIP sits beside it. */
  hasQr: boolean;
  /**
   * The methods the owner's CHIP account listed when last checked, for checkout's first
   * draw (the API says what it takes at the order's total); null when there is no
   * account, or CHIP refused its key, or (in production) it is a test key.
   */
  chipMethods: string[] | null;
}

/** The shop plus what checkout draws; null for a personal page or a closed Store. */
export async function getCheckout(handle: string, now = new Date()): Promise<Checkout | null> {
  const shop = await getPublicShop(handle);
  if (!shop) return null;
  const page = await prismaRead.page.findUnique({
    where: { handle: handle.toLowerCase() },
    select: {
      mode: true,
      paidUntil: true,
      ordersPlaced: true,
      ordersAtTrialReset: true,
      paymentQrKey: true,
      bankName: true,
      bankAccountName: true,
      bankAccountNumber: true,
      // Never the sealed key: the read-only role cannot read that column at all.
      paymentAccount: { select: { methods: true, isTest: true, lastErrorAt: true } },
    },
  });
  if (!page) return null;
  const { paymentQrKey, bankName, bankAccountName, bankAccountNumber, paymentAccount: chip, ...plan } = page;
  return {
    ...shop,
    canTakeOrders: canTakeOrders({ ...plan, now }),
    // The same rule as storeGaps: a QR, or all three bank details.
    payByQr: Boolean(paymentQrKey || (bankName && bankAccountName && bankAccountNumber)),
    hasQr: Boolean(paymentQrKey),
    chipMethods: usableChipMethods(chip),
  };
}

/**
 * One available item by its slug, with the shop it is on (everything
 * `getCheckout` gives, items included, so a caller can price the basket); null
 * for an unknown or unavailable slug, a personal page or a closed Store. The
 * slug is unique per page, so the handle is part of the question.
 */
export async function getShopItem(handle: string, slug: string, now = new Date()): Promise<{ shop: Checkout; item: ShopItem } | null> {
  const shop = await getCheckout(handle, now);
  const item = shop?.items.find((candidate) => candidate.slug === slug);
  return shop && item ? { shop, item } : null;
}
