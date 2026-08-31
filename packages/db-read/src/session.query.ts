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
 * BOTH clocks are checked, and both in the WHERE clause rather than after the
 * read, so an invalid row can never be returned to a caller that forgets to
 * look. The absolute one is `expiresAt`, fixed at creation. The idle one is
 * `lastSeenAt`, which the API moves on its sliding refresh.
 *
 * Checking only `expiresAt` here would let this disagree with the API: between
 * fourteen and thirty days of inactivity the API treats a session as dead while
 * this would still call it live, so the layout would render a dashboard whose
 * every request then 401s. Two components disagreeing about who is signed in is
 * worse than either answer.
 */
export async function getOwnerSession(value: string): Promise<{ accountId: string } | null> {
  const session = await prismaRead.session.findFirst({
    where: {
      id: hashSessionValue(value),
      expiresAt: { gt: new Date() },
      lastSeenAt: { gt: new Date(Date.now() - SESSION_IDLE_TTL_MS) },
    },
    select: { accountId: true },
  });

  return session ? { accountId: session.accountId } : null;
}
