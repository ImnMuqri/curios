import { currentPeriod } from '@curios/core';
import { prismaRead } from '../client.js';
import { getSettings } from '../settings.query.js';
import type { ReportReasonKey } from '@curios/core/report';
import { DAY_MS, malaysiaDay, malaysiaMidnight } from './days.js';
import { listReportGroups } from './reports.query.js';

export type Period = 'today' | '7d' | '30d';

export interface Overview {
  livePages: { count: number; newInPeriod: number };
  /** Pages with a PAID, non-grant payment still running. `newInPeriod`: the first such payment fell in the period. */
  paying: { count: number; newInPeriod: number };
  /** Sen taken in the period: PAID, provider not GRANT, by `paidAt`. */
  revenueCents: number;
  conversations: { count: number; previous: number };
  answered: { answered: number; recorded: number };
  aiCost: {
    /**
     * Thousandths of a US cent (1 cent = 1000 milli-cents): the unit
     * ModelCall.costMilliCents is stored in, set by packages/gateway/src/pricing.ts.
     */
    milliCents: number;
    /** Rounded to a whole milli-cent; 0 when there were no conversations. */
    perConversationMilliCents: number;
  };
  /** Conversations per Malaysian day, 7 entries, oldest first, today last. */
  perDay: { day: string; count: number }[];
  needsYou: {
    failedReads: number;
    atCap: { count: number; names: string[] };
    plansEnding: number;
    /** Pages with an open report, and the page with the most. */
    reported: {
      pages: number;
      /** `count` is today's reports when `today`, else all the page's open ones. */
      top: { displayName: string; count: number; reason: ReportReasonKey; today: boolean } | null;
    };
  };
  newPages: {
    name: string;
    handle: string;
    mode: 'PERSONAL' | 'BUSINESS';
    createdAt: Date;
    factCount: number;
    hasConversation: boolean;
  }[];
  /** Live pages only (published, not suspended), so personal + business equals livePages.count. */
  byKind: { personal: number; business: number };
}

const PERIOD_DAYS: Record<Period, number> = { today: 1, '7d': 7, '30d': 30 };

/**
 * The Overview board. A period is whole Malaysian days ending now, today
 * included: `today` starts at Malaysia midnight, `7d` six midnights earlier.
 * `previous` is the window of the same length just before it.
 */
export async function getOverview(period: Period, now: Date): Promise<Overview> {
  const days = PERIOD_DAYS[period];
  const start = malaysiaMidnight(now, days - 1);
  const previousStart = malaysiaMidnight(now, 2 * days - 1);
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const inPeriod = { gte: start, lte: now };
  const firstDay = malaysiaMidnight(now, 6);
  // At the cap means at the admin's cap, the one the chat enforces.
  const { cap } = await getSettings();

  const [
    liveCount,
    liveNew,
    payingPages,
    revenue,
    conversations,
    previous,
    answered,
    recorded,
    cost,
    weekConversations,
    failedReads,
    capped,
    endingPages,
    newest,
    personal,
    business,
    reportGroups,
  ] = await Promise.all([
    prismaRead.page.count({ where: { published: true, suspendedAt: null } }),
    prismaRead.page.count({ where: { published: true, suspendedAt: null, createdAt: inPeriod } }),
    prismaRead.payment.findMany({
      where: { status: 'PAID', provider: { not: 'GRANT' }, grantedUntil: { gt: now }, pageId: { not: null } },
      select: { pageId: true },
      distinct: ['pageId'],
    }),
    prismaRead.payment.aggregate({ _sum: { amountCents: true }, where: { status: 'PAID', provider: { not: 'GRANT' }, paidAt: inPeriod } }),
    prismaRead.conversation.count({ where: { createdAt: inPeriod } }),
    prismaRead.conversation.count({ where: { createdAt: { gte: previousStart, lt: start } } }),
    prismaRead.questionAsk.count({ where: { askedAt: inPeriod, answered: true } }),
    prismaRead.questionAsk.count({ where: { askedAt: inPeriod, answered: { not: null } } }),
    prismaRead.modelCall.aggregate({ _sum: { costMilliCents: true }, where: { createdAt: inPeriod } }),
    prismaRead.conversation.findMany({ where: { createdAt: { gte: firstDay, lte: now } }, select: { createdAt: true } }),
    prismaRead.ingestion.count({ where: { status: 'FAILED', updatedAt: { gt: weekAgo, lte: now } } }),
    prismaRead.usageCounter.findMany({
      where: { period: currentPeriod(now), count: { gte: cap } },
      orderBy: { count: 'desc' },
      select: { page: { select: { displayName: true } } },
    }),
    prismaRead.page.findMany({
      where: { paidUntil: { gt: now, lte: new Date(now.getTime() + 7 * DAY_MS) } },
      select: { paidUntil: true, payments: { where: { status: 'PAID' }, select: { provider: true, grantedUntil: true } } },
    }),
    prismaRead.page.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 5,
      select: {
        displayName: true,
        handle: true,
        mode: true,
        createdAt: true,
        _count: { select: { facts: { where: { rejectedAt: null } } } },
        conversations: { take: 1, select: { id: true } },
      },
    }),
    prismaRead.page.count({ where: { mode: 'PERSONAL', published: true, suspendedAt: null } }),
    prismaRead.page.count({ where: { mode: 'BUSINESS', published: true, suspendedAt: null } }),
    listReportGroups({ status: 'open', now }),
  ]);

  // When each paying page first paid for real, to see which began in the period.
  const payingIds = payingPages.map((p) => p.pageId as string);
  const firstPaid = payingIds.length
    ? await prismaRead.payment.groupBy({
        by: ['pageId'],
        where: { pageId: { in: payingIds }, status: 'PAID', provider: { not: 'GRANT' } },
        _min: { paidAt: true },
      })
    : [];
  const payingNew = firstPaid.filter((row) => row._min.paidAt !== null && row._min.paidAt >= start && row._min.paidAt <= now).length;

  const perDay = Array.from({ length: 7 }, (_, i) => ({ day: malaysiaDay(new Date(firstDay.getTime() + i * DAY_MS)), count: 0 }));
  const slots = new Map(perDay.map((entry) => [entry.day, entry]));
  for (const row of weekConversations) {
    const slot = slots.get(malaysiaDay(row.createdAt));
    if (slot) slot.count += 1;
  }

  const milliCents = cost._sum.costMilliCents ?? 0;
  // The covering payment is the one whose grant produced this paidUntil; a free
  // month is not a plan ending that the owner might fail to renew.
  const plansEnding = endingPages.filter((page) => {
    const covering = page.payments.find((p) => p.grantedUntil?.getTime() === page.paidUntil?.getTime());
    return covering?.provider !== 'GRANT';
  }).length;

  return {
    livePages: { count: liveCount, newInPeriod: liveNew },
    paying: { count: payingIds.length, newInPeriod: payingNew },
    revenueCents: revenue._sum.amountCents ?? 0,
    conversations: { count: conversations, previous },
    answered: { answered, recorded },
    aiCost: { milliCents, perConversationMilliCents: conversations > 0 ? Math.round(milliCents / conversations) : 0 },
    perDay,
    needsYou: {
      failedReads,
      atCap: { count: capped.length, names: capped.slice(0, 2).map((row) => row.page.displayName) },
      plansEnding,
      reported: {
        pages: reportGroups.length,
        top: reportGroups[0]
          ? {
              displayName: reportGroups[0].displayName,
              count: reportGroups[0].countToday > 0 ? reportGroups[0].countToday : reportGroups[0].count,
              reason: reportGroups[0].reason,
              today: reportGroups[0].countToday > 0,
            }
          : null,
      },
    },
    newPages: newest.map((page) => ({
      name: page.displayName,
      handle: page.handle,
      mode: page.mode,
      createdAt: page.createdAt,
      factCount: page._count.facts,
      hasConversation: page.conversations.length > 0,
    })),
    byKind: { personal, business },
  };
}
