import { conversationCap, currentPeriod, initials, maskPhone } from '@curios/core';
import { prismaRead } from '../client.js';
import { planOf, type AdminPlan } from './pages.query.js';

export interface OwnerView {
  profile: {
    handle: string;
    displayName: string;
    bio: string | null;
    mode: 'PERSONAL' | 'BUSINESS';
    language: string;
    published: boolean;
    links: { label: string; url: string }[];
  };
  plan: {
    plan: AdminPlan;
    paidUntil: Date | null;
    conversationsThisMonth: number;
    cap: number;
    leadsThisMonth: number;
    ordersThisMonth: number;
  };
  facts: { text: string; status: 'Live' | 'Pending' | 'Rejected' }[];
  items: { name: string; priceCents: number | null; available: boolean }[];
  /** A lead stores a phone number and no name, so there is no name to mask. */
  leads: { maskedPhone: string; createdAt: Date; slotsFilled: string[] }[];
  orders: { number: number; maskedName: string; totalCents: number; status: string; createdAt: Date }[];
  /** Count and times only: never a message. */
  conversations: { thisMonth: number; latest: Date[] };
}

const FACTS_SHOWN = 200;
const ITEMS_SHOWN = 100;
const LEADS_SHOWN = 20;
const ORDERS_SHOWN = 20;

/**
 * The page as its owner sees it, masked for the admin. Everything is selected
 * by name, and nothing of a customer comes out whole: no message content, no
 * receipts, no addresses, no emails; phones keep country code and last two
 * digits; names shrink to initials.
 */
export async function getOwnerView(pageId: string, now = new Date()): Promise<OwnerView | null> {
  const page = await prismaRead.page.findUnique({
    where: { id: pageId },
    select: {
      handle: true,
      displayName: true,
      bio: true,
      mode: true,
      language: true,
      published: true,
      paidUntil: true,
      leadsCaptured: true,
      links: { orderBy: { position: 'asc' }, select: { label: true, url: true } },
    },
  });
  if (!page) return null;

  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [counter, facts, items, leads, orders, latest, leadsThisMonth, ordersThisMonth] = await Promise.all([
    prismaRead.usageCounter.findUnique({ where: { pageId_period: { pageId, period: currentPeriod(now) } }, select: { count: true } }),
    prismaRead.fact.findMany({
      where: { pageId },
      orderBy: { createdAt: 'desc' },
      take: FACTS_SHOWN,
      select: { claim: true, verified: true, rejectedAt: true },
    }),
    prismaRead.item.findMany({ where: { pageId }, orderBy: { position: 'asc' }, take: ITEMS_SHOWN, select: { name: true, priceCents: true, available: true } }),
    prismaRead.lead.findMany({ where: { pageId }, orderBy: { createdAt: 'desc' }, take: LEADS_SHOWN, select: { phone: true, slots: true, createdAt: true } }),
    prismaRead.order.findMany({
      where: { pageId },
      orderBy: { createdAt: 'desc' },
      take: ORDERS_SHOWN,
      select: { number: true, customerName: true, totalCents: true, status: true, createdAt: true },
    }),
    prismaRead.conversation.findMany({ where: { pageId }, orderBy: { createdAt: 'desc' }, take: 10, select: { createdAt: true } }),
    prismaRead.lead.count({ where: { pageId, createdAt: { gte: monthStart, lte: now } } }),
    prismaRead.order.count({ where: { pageId, createdAt: { gte: monthStart, lte: now } } }),
  ]);
  const thisMonth = counter?.count ?? 0;

  return {
    profile: {
      handle: page.handle,
      displayName: page.displayName,
      bio: page.bio,
      mode: page.mode,
      language: page.language,
      published: page.published,
      links: page.links,
    },
    plan: {
      plan: planOf(page.mode, page.paidUntil, page.leadsCaptured, now),
      paidUntil: page.paidUntil,
      conversationsThisMonth: thisMonth,
      cap: conversationCap(),
      leadsThisMonth,
      ordersThisMonth,
    },
    facts: facts.map((fact) => ({
      text: fact.claim,
      status: fact.rejectedAt ? 'Rejected' : fact.verified ? 'Live' : 'Pending',
    })),
    items,
    leads: leads.map((lead) => ({
      maskedPhone: maskPhone(lead.phone),
      createdAt: lead.createdAt,
      // Names of the slots, never what was said in them.
      slotsFilled: Object.entries((lead.slots as Record<string, unknown> | null) ?? {})
        .filter(([, value]) => typeof value === 'string' && value !== '')
        .map(([name]) => name),
    })),
    orders: orders.map((order) => ({
      number: order.number,
      maskedName: initials(order.customerName),
      totalCents: order.totalCents,
      status: order.status,
      createdAt: order.createdAt,
    })),
    conversations: { thisMonth, latest: latest.map((c) => c.createdAt) },
  };
}
