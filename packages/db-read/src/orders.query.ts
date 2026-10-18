import { canTakeOrders, hashSessionValue } from '@curios/core';
import { malaysiaToday } from '@curios/core/orders';
import type { HeadingFont, PageBackground, PageStyle } from '@curios/core/bento';
import type { DeliveryMode } from '@curios/core/store';
import { prismaRead } from './client.js';
import { getPublicShop, type PublicShop } from './shop.query.js';

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
  createdAt: Date;
  lines: { itemName: string; optionLabel: string | null; unitPriceCents: number; quantity: number; photoKey: string | null }[];
}

const dayText = (day: Date): string => day.toISOString().slice(0, 10);

/**
 * This owner's orders, newest first (at most 100), scoped through the page's
 * owner inside the query: an order carries a name, a phone and an address.
 */
export async function getOwnerOrders(accountId: string, options: { limit?: number } = {}): Promise<OwnerOrder[]> {
  const rows = await prismaRead.order.findMany({
    where: { page: { accountId } },
    orderBy: [{ createdAt: 'desc' }, { number: 'desc' }],
    take: Math.min(options.limit ?? 50, 100),
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
  };
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
        },
      },
    },
  });
  if (!row) return null;
  const { day, lines, ...order } = row;
  return {
    ...order,
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
}

/** The shop plus what checkout draws; null for a personal page or a closed Store. */
export async function getCheckout(handle: string, now = new Date()): Promise<Checkout | null> {
  const shop = await getPublicShop(handle);
  if (!shop) return null;
  const plan = await prismaRead.page.findUnique({
    where: { handle: handle.toLowerCase() },
    select: { mode: true, paidUntil: true, ordersPlaced: true, ordersAtTrialReset: true },
  });
  if (!plan) return null;
  return { ...shop, canTakeOrders: canTakeOrders({ ...plan, now }) };
}
