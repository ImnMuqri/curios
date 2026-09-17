import { conversationCap } from '@curios/core';
import { prismaRead } from './client.js';

export interface ConversationUsage {
  /** Conversations started this period. */
  used: number;
  /** The cap in force, as the API computes it. */
  cap: number;
  /** The period key, `YYYY-MM`. */
  period: string;
}

/**
 * This month's conversation usage for one page.
 *
 * The period is `now.toISOString().slice(0, 7)` because that is exactly what
 * `currentPeriod()` in the API's chat service uses to increment the counter.
 * Two different definitions of "this month" would show an owner a number that
 * nothing enforces, which is worse than showing no number at all.
 *
 * `conversationCap()` reads `CONVERSATION_CAP_PER_MONTH` at call time, so this
 * app and the API must be given the same value -- or both must leave it unset.
 *
 * `now` is a parameter for the same reason it is everywhere else here: a
 * function that reads the clock cannot be tested at a month boundary.
 */
export async function getConversationUsage(pageId: string, now: Date): Promise<ConversationUsage> {
  const period = now.toISOString().slice(0, 7);
  const counter = await prismaRead.usageCounter.findUnique({
    where: { pageId_period: { pageId, period } },
    select: { count: true },
  });

  return { used: counter?.count ?? 0, cap: conversationCap(), period };
}
