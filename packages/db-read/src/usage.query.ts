import { prismaRead } from './client.js';
import { getSettings } from './settings.query.js';

export interface ConversationUsage {
  /** Conversations started this period. */
  used: number;
  /** The cap in force: the admin's (`Settings.cap`), the one the API enforces. */
  cap: number;
  /** The period key, `YYYY-MM`. */
  period: string;
}

/**
 * This month's conversation usage for one page.
 *
 * The period is `now.toISOString().slice(0, 7)` because that is exactly what
 * `currentPeriod()` in @curios/core (period.ts) uses to increment the counter.
 * Two different definitions of "this month" would show an owner a number that
 * nothing enforces, which is worse than showing no number at all.
 *
 * The cap is the admin's, from the settings both this app and the API read
 * (each cached 30 s), so the two can differ for at most that long.
 *
 * `now` is a parameter for the same reason it is everywhere else here: a
 * function that reads the clock cannot be tested at a month boundary.
 */
export async function getConversationUsage(pageId: string, now: Date): Promise<ConversationUsage> {
  const period = now.toISOString().slice(0, 7);
  const [counter, { cap }] = await Promise.all([
    prismaRead.usageCounter.findUnique({
      where: { pageId_period: { pageId, period } },
      select: { count: true },
    }),
    getSettings(),
  ]);

  return { used: counter?.count ?? 0, cap, period };
}

/**
 * Leads this page captured this month, for the billing screen's meter. The
 * same month as the conversation counter above (UTC, `YYYY-MM`), so the two
 * meters beside each other reset together.
 */
export async function countLeadsThisMonth(pageId: string, now: Date): Promise<number> {
  return prismaRead.lead.count({ where: { pageId, createdAt: { gte: monthStart(now), lte: now } } });
}

/**
 * Orders placed on this page this month, for the billing screen's Orders
 * meter. The same UTC month as the two meters beside it, for the same reason:
 * one "Resets" date for all three.
 */
export async function countOrdersThisMonth(pageId: string, now: Date): Promise<number> {
  return prismaRead.order.count({ where: { pageId, createdAt: { gte: monthStart(now), lte: now } } });
}

function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
