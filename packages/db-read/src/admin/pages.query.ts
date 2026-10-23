import type { Prisma } from '@prisma/client';
import { conversationCap, currentPeriod, planState } from '@curios/core';
import { prismaRead } from '../client.js';

export type PageFilter = 'all' | 'business' | 'personal' | 'lapsed' | 'flagged';
export type AdminPageStatus = 'Live' | 'Draft' | 'Lapsed' | 'Suspended';
export type AdminPlan = 'Personal' | 'Business' | 'Business trial' | 'Lapsed';

export interface AdminPageRow {
  id: string;
  handle: string;
  displayName: string;
  mode: 'PERSONAL' | 'BUSINESS';
  status: AdminPageStatus;
  ownerEmail: string;
  createdAt: Date;
}

export interface AdminPageDetail extends AdminPageRow {
  signInMethods: ('google' | 'password')[];
  plan: AdminPlan;
  paidUntil: Date | null;
  conversationsThisMonth: number;
  cap: number;
  factCount: number;
  suspendedAt: Date | null;
  suspendReason: string | null;
  /** How many GRANT payments the page has had. */
  grantedMonths: number;
}

const ROW_SELECT = {
  id: true,
  handle: true,
  displayName: true,
  mode: true,
  published: true,
  paidUntil: true,
  suspendedAt: true,
  createdAt: true,
  account: { select: { email: true } },
} satisfies Prisma.PageSelect;

type RowSource = Prisma.PageGetPayload<{ select: typeof ROW_SELECT }>;

/**
 * Suspended beats everything; then Lapsed (a business page whose paid plan has
 * ended, whether or not it is published); then Draft; otherwise Live. The
 * `lapsed` filter below is the same test, so a filter and its badge agree.
 */
function statusOf(page: RowSource, now: Date): AdminPageStatus {
  if (page.suspendedAt) return 'Suspended';
  if (page.mode === 'BUSINESS' && page.paidUntil && page.paidUntil.getTime() <= now.getTime()) return 'Lapsed';
  return page.published ? 'Live' : 'Draft';
}

function rowOf(page: RowSource, now: Date): AdminPageRow {
  return {
    id: page.id,
    handle: page.handle,
    displayName: page.displayName,
    mode: page.mode,
    status: statusOf(page, now),
    ownerEmail: page.account.email,
    createdAt: page.createdAt,
  };
}

/** Pages for the Pages table, newest first. `q` matches handle, display name or owner email, any case. */
export async function listAdminPages(options: {
  q?: string;
  filter?: PageFilter;
  limit?: number;
  now?: Date;
}): Promise<AdminPageRow[]> {
  const now = options.now ?? new Date();
  const filter = options.filter ?? 'all';
  const q = options.q?.trim();
  const where: Prisma.PageWhereInput = {};
  if (filter === 'business') where.mode = 'BUSINESS';
  if (filter === 'personal') where.mode = 'PERSONAL';
  if (filter === 'flagged') where.suspendedAt = { not: null };
  if (filter === 'lapsed') Object.assign(where, { suspendedAt: null, mode: 'BUSINESS', paidUntil: { lte: now } });
  if (q) {
    where.OR = [
      { handle: { contains: q, mode: 'insensitive' } },
      { displayName: { contains: q, mode: 'insensitive' } },
      { account: { email: { contains: q, mode: 'insensitive' } } },
    ];
  }

  const pages = await prismaRead.page.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: Math.min(Math.max(options.limit ?? 50, 1), 200),
    select: ROW_SELECT,
  });
  return pages.map((page) => rowOf(page, now));
}

/** One page for the admin's page screen, or null. */
export async function getAdminPage(id: string, now = new Date()): Promise<AdminPageDetail | null> {
  const page = await prismaRead.page.findUnique({
    where: { id },
    select: {
      ...ROW_SELECT,
      leadsCaptured: true,
      suspendReason: true,
      account: { select: { email: true, password: { select: { id: true } }, identities: { select: { provider: true } } } },
      _count: { select: { facts: true } },
    },
  });
  if (!page) return null;

  const [counter, grantedMonths] = await Promise.all([
    prismaRead.usageCounter.findUnique({ where: { pageId_period: { pageId: id, period: currentPeriod(now) } }, select: { count: true } }),
    prismaRead.payment.count({ where: { pageId: id, provider: 'GRANT', status: 'PAID' } }),
  ]);

  const signInMethods: ('google' | 'password')[] = [];
  if (page.account.identities.some((identity) => identity.provider === 'GOOGLE')) signInMethods.push('google');
  if (page.account.password) signInMethods.push('password');

  return {
    ...rowOf(page, now),
    signInMethods,
    plan: planOf(page.mode, page.paidUntil, page.leadsCaptured, now),
    paidUntil: page.paidUntil,
    conversationsThisMonth: counter?.count ?? 0,
    cap: conversationCap(),
    factCount: page._count.facts,
    suspendedAt: page.suspendedAt,
    suspendReason: page.suspendReason,
    grantedMonths,
  };
}

/**
 * The admin's plan label from `planState`. A plan that ran out is Lapsed even
 * while free leads remain (as the owner's own label has it); a business page
 * that never paid is a trial, spent or not.
 */
export function planOf(mode: 'PERSONAL' | 'BUSINESS', paidUntil: Date | null, leadsCaptured: number, now: Date): AdminPlan {
  const state = planState({ mode, paidUntil, leadsCaptured, now });
  switch (state.kind) {
    case 'personal':
      return 'Personal';
    case 'paid':
      return 'Business';
    case 'trial':
      return state.lapsedOn ? 'Lapsed' : 'Business trial';
    case 'trialSpent':
      return 'Business trial';
    case 'lapsed':
      return 'Lapsed';
  }
}
