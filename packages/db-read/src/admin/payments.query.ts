import { malaysiaToday } from '@curios/core/orders';
import { prismaRead } from '../client.js';
import { DAY_MS, MALAYSIA_OFFSET_MS, malaysiaMidnight } from './days.js';
import { countPlansEnding, getPayingPages, getRevenueCents, PERIOD_DAYS, type Period } from './overview.query.js';

export type PaymentRowStatus = 'Paid' | 'Not confirmed' | 'Abandoned' | 'Failed';

export interface PaymentRow {
  id: string;
  createdAt: Date;
  /** The page's name, else the handle kept on the payment (the page may be gone), else '—'. */
  name: string;
  plan: 'MONTHLY' | 'ANNUAL';
  /** "FPX", "Card · Visa"...; null for payments made before it was recorded. */
  paidVia: string | null;
  amountCents: number;
  status: PaymentRowStatus;
  providerRef: string | null;
}

export interface WebhookRow {
  id: string;
  eventType: string;
  purchaseId: string;
  attempts: number;
  outcome: 'ok' | 'failed' | null;
  statusCode: number | null;
  lastAttemptAt: Date;
  /** The page the purchase's payment belongs to; null if none. */
  displayName: string | null;
}

export interface Payments {
  /** Sen taken in the period (GRANT never counts). */
  receivedCents: number;
  paying: { total: number; monthly: number; annual: number };
  endingThisWeek: number;
  failedWebhooks24h: number;
  /** The 50 newest CHIP payments. */
  rows: PaymentRow[];
  /** Every webhook message whose last attempt was in the last 24 hours, newest first (at most 100). */
  webhooks: WebhookRow[];
  /** Shop orders paid through CHIP this Malaysian month. */
  shop: { orders: number; totalCents: number; shops: number };
}

const STATUS: Record<'PAID' | 'PENDING' | 'FAILED' | 'EXPIRED', PaymentRowStatus> = {
  PAID: 'Paid',
  PENDING: 'Not confirmed',
  EXPIRED: 'Abandoned',
  FAILED: 'Failed',
};

export async function getPayments(period: Period, now: Date): Promise<Payments> {
  const start = malaysiaMidnight(now, PERIOD_DAYS[period] - 1);
  const dayAgo = new Date(now.getTime() - DAY_MS);
  const monthStart = new Date(Date.parse(`${malaysiaToday(now).slice(0, 7)}-01T00:00:00Z`) - MALAYSIA_OFFSET_MS);

  const [received, payingPages, endingThisWeek, failedWebhooks24h, payments, events, shopOrders] = await Promise.all([
    getRevenueCents(start, now),
    getPayingPages(now),
    countPlansEnding(now),
    prismaRead.chipWebhookEvent.count({ where: { outcome: 'failed', lastAttemptAt: { gte: dayAgo, lte: now } } }),
    prismaRead.payment.findMany({
      where: { provider: 'CHIP' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50,
      select: { id: true, createdAt: true, pageHandle: true, plan: true, paidVia: true, amountCents: true, status: true, providerRef: true, page: { select: { displayName: true } } },
    }),
    // Never `body`: the role cannot read it, and it holds the payer's name and email.
    prismaRead.chipWebhookEvent.findMany({
      where: { lastAttemptAt: { gte: dayAgo, lte: now } },
      orderBy: { lastAttemptAt: 'desc' },
      take: 100,
      select: { id: true, eventType: true, purchaseId: true, attempts: true, outcome: true, statusCode: true, lastAttemptAt: true },
    }),
    // One row per shop, summed in SQL: the month's orders are never loaded.
    prismaRead.order.groupBy({
      by: ['pageId'],
      where: { paidVia: 'CHIP', paidAt: { gte: monthStart, lte: now } },
      _sum: { totalCents: true },
      _count: { _all: true },
    }),
  ]);

  const owners = events.length
    ? await prismaRead.payment.findMany({
        where: { providerRef: { in: events.map((event) => event.purchaseId) } },
        select: { providerRef: true, page: { select: { displayName: true } } },
      })
    : [];
  const nameOf = new Map(owners.map((payment) => [payment.providerRef, payment.page?.displayName ?? null]));

  return {
    receivedCents: received,
    paying: {
      total: payingPages.length,
      monthly: payingPages.filter((page) => page.plan === 'MONTHLY').length,
      annual: payingPages.filter((page) => page.plan === 'ANNUAL').length,
    },
    endingThisWeek,
    failedWebhooks24h,
    rows: payments.map((payment) => ({
      id: payment.id,
      createdAt: payment.createdAt,
      name: payment.page?.displayName ?? payment.pageHandle ?? '—',
      plan: payment.plan,
      paidVia: payment.paidVia,
      amountCents: payment.amountCents,
      status: STATUS[payment.status],
      providerRef: payment.providerRef,
    })),
    webhooks: events.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      purchaseId: event.purchaseId,
      attempts: event.attempts,
      outcome: event.outcome === 'ok' || event.outcome === 'failed' ? event.outcome : null,
      statusCode: event.statusCode,
      lastAttemptAt: event.lastAttemptAt,
      displayName: nameOf.get(event.purchaseId) ?? null,
    })),
    shop: {
      orders: shopOrders.reduce((sum, shop) => sum + shop._count._all, 0),
      totalCents: shopOrders.reduce((sum, shop) => sum + (shop._sum.totalCents ?? 0), 0),
      shops: shopOrders.length,
    },
  };
}
