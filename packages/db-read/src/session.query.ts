import { hashSessionValue, SESSION_IDLE_TTL_MS } from '@curios/core';
import { prismaRead } from './client.js';

/**
 * Whose session this is, or null. Read-only by design.
 *
 * The `/app` layout validates a session against the database, and `apps/web`
 * connects as `curios_readonly`. The API's `validateSession` also performs the
 * sliding refresh, which is a write, so the layout cannot call it -- that is
 * the trap FRONTEND.md fell into when it said the cookie was "refreshed by
 * middleware". Refreshing stays in the API, where a write is legal.
 *
 * Checks both clocks `validateSession` checks -- absolute expiry and the idle
 * window -- not just `expiresAt`. Between 14 and 30 days of inactivity the
 * API already calls a session dead; checking `expiresAt` alone here would
 * still call it live, and the layout would render a dashboard whose next
 * request 401s. Both checks live in the WHERE clause rather than after the
 * read, so a dead row can never be returned by a caller that forgets to look.
 */
export async function getOwnerSession(value: string): Promise<{ accountId: string } | null> {
  const now = Date.now();
  const session = await prismaRead.session.findFirst({
    where: {
      id: hashSessionValue(value),
      expiresAt: { gt: new Date(now) },
      lastSeenAt: { gte: new Date(now - SESSION_IDLE_TTL_MS) },
    },
    select: { accountId: true },
  });

  return session ? { accountId: session.accountId } : null;
}
