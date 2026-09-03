import type { PrismaClient } from '@curios/db';
import {
  SESSION_ABSOLUTE_TTL_MS,
  SESSION_IDLE_TTL_MS,
  SESSION_COOKIE as CORE_SESSION_COOKIE,
} from '@curios/core';
import { createToken, hashToken } from '../../lib/tokens.js';

export const SESSION_COOKIE = CORE_SESSION_COOKIE;

// Re-exported under these names rather than imported directly at each call
// site below: this file is the historical home of both, and `auth.routes.ts`
// already imports `ABSOLUTE_TTL_MS` from here. The values themselves live in
// @curios/core so packages/db-read can enforce the same two clocks.
/** However active the owner, a session dies 30 days after it was issued. */
export const ABSOLUTE_TTL_MS = SESSION_ABSOLUTE_TTL_MS;
/** An untouched session dies after a fortnight. */
export const IDLE_TTL_MS = SESSION_IDLE_TTL_MS;

/**
 * Refreshing on every request would make this the most-written table in the
 * database for no benefit. Refreshing once past half the idle window keeps an
 * active owner signed in indefinitely at roughly one write per week.
 */
const REFRESH_AFTER_MS = IDLE_TTL_MS / 2;

export async function createSession(
  prisma: PrismaClient,
  accountId: string,
): Promise<{ value: string; expiresAt: Date }> {
  const { value, hash } = createToken();
  const expiresAt = new Date(Date.now() + ABSOLUTE_TTL_MS);

  await prisma.session.create({ data: { id: hash, accountId, expiresAt } });

  return { value, expiresAt };
}

export async function validateSession(
  prisma: PrismaClient,
  value: string,
): Promise<{ accountId: string } | null> {
  const session = await prisma.session.findUnique({
    where: { id: hashToken(value) },
    select: { id: true, accountId: true, expiresAt: true, lastSeenAt: true },
  });

  if (!session) return null;

  const now = Date.now();
  if (session.expiresAt.getTime() <= now) return null;
  if (now - session.lastSeenAt.getTime() > IDLE_TTL_MS) return null;

  if (now - session.lastSeenAt.getTime() > REFRESH_AFTER_MS) {
    await prisma.session.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date(now) },
    });
  }

  return { accountId: session.accountId };
}

export async function revokeSession(prisma: PrismaClient, value: string): Promise<void> {
  // deleteMany rather than delete: signing out twice is not an error.
  await prisma.session.deleteMany({ where: { id: hashToken(value) } });
}

/**
 * No caller in this plan, deliberately. Task 9's password reset inlines the
 * same delete inside a `$transaction` so the credential change and the
 * revocation cannot half-happen; this named form is what sign-out-everywhere
 * calls in plan 2. It is exported and tested now because the reset path proves
 * the behaviour matters, and a reviewer should know why it looks unused.
 */
export async function revokeAllSessions(
  prisma: PrismaClient,
  accountId: string,
): Promise<void> {
  await prisma.session.deleteMany({ where: { accountId } });
}
