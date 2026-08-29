import type { AuthTokenKind, PrismaClient } from '@curios/db';
import { createToken, hashToken } from '../../lib/tokens.js';

/** Long enough to survive a slow inbox, short enough that a leaked link ages out. */
export const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
/** Shorter, because this one changes a credential. */
export const RESET_TTL_MS = 60 * 60 * 1000;

function ttlFor(kind: AuthTokenKind): number {
  return kind === 'PASSWORD_RESET' ? RESET_TTL_MS : VERIFICATION_TTL_MS;
}

export async function issueToken(
  prisma: PrismaClient,
  accountId: string,
  kind: AuthTokenKind,
): Promise<string> {
  const { value, hash } = createToken();

  await prisma.authToken.create({
    data: { id: hash, accountId, kind, expiresAt: new Date(Date.now() + ttlFor(kind)) },
  });

  return value;
}

/**
 * Marks the token spent and returns whose it was, or null.
 *
 * The update is the check. A read-then-write would let two simultaneous uses of
 * one link both pass -- a double-clicked reset link is enough to trigger it --
 * so the `usedAt: null` guard lives in the WHERE clause and the row itself is
 * the serialisation point. The same reasoning as the sign-in race already fixed
 * in `findOrCreateAccountForGoogle`.
 */
export async function consumeToken(
  prisma: PrismaClient,
  value: string,
  kind: AuthTokenKind,
): Promise<{ accountId: string } | null> {
  const id = hashToken(value);

  const claimed = await prisma.authToken.updateMany({
    where: { id, kind, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });

  if (claimed.count !== 1) return null;

  const token = await prisma.authToken.findUnique({ where: { id }, select: { accountId: true } });
  return token ? { accountId: token.accountId } : null;
}
