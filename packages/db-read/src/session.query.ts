import { hashSessionValue } from '@curios/core';
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
 * Expiry is checked in the WHERE clause rather than after the read, so an
 * expired row can never be returned by a caller that forgets to look.
 */
export async function getOwnerSession(value: string): Promise<{ accountId: string } | null> {
  const session = await prismaRead.session.findFirst({
    where: { id: hashSessionValue(value), expiresAt: { gt: new Date() } },
    select: { accountId: true },
  });

  return session ? { accountId: session.accountId } : null;
}
