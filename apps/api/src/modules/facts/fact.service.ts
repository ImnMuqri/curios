import type { PrismaClient } from '@curios/db';
import { normalizeClaim } from '@curios/core';

export class FactNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
  constructor() {
    // 404 rather than 403 for a fact on someone else's page: a 403 confirms
    // the id exists.
    super('No such fact.');
    this.name = 'FactNotFoundError';
  }
}

export class DuplicateFactError extends Error {
  readonly statusCode = 409;
  readonly code = 'FACT_DUPLICATE';
  constructor() {
    super('You already have a fact that says this.');
    this.name = 'DuplicateFactError';
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'
  );
}

/**
 * Accepts exactly one fact.
 *
 * There is no plural form of this function and there must never be one. The
 * spec's single hard rule is that nothing sets `verified: true` except an
 * explicit human action on one specific fact, because a bulk-accept control is
 * how an unreviewed price reaches a customer.
 *
 * A rejected fact cannot be accepted: it was already answered.
 */
export async function verifyFact(
  prisma: PrismaClient,
  accountId: string,
  factId: string,
): Promise<void> {
  const claimed = await prisma.fact.updateMany({
    where: { id: factId, page: { accountId }, rejectedAt: null },
    data: { verified: true },
  });

  if (claimed.count !== 1) throw new FactNotFoundError();
}

/**
 * Rewrites a claim, and the dedupe key with it.
 *
 * `normalizeClaim` is re-run rather than left alone, so the key never drifts
 * from the text it is meant to key. That is also what makes a collision
 * possible here, and a collision is an owner-fixable fact rather than a 500.
 */
export async function editFact(
  prisma: PrismaClient,
  accountId: string,
  factId: string,
  claim: string,
): Promise<void> {
  try {
    const updated = await prisma.fact.updateMany({
      where: { id: factId, page: { accountId } },
      data: { claim, normalizedClaim: normalizeClaim(claim) },
    });
    if (updated.count !== 1) throw new FactNotFoundError();
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicateFactError();
    throw error;
  }
}

/**
 * Rejects a fact without deleting the row.
 *
 * The row is what suppresses the re-ask: extraction writes with
 * `skipDuplicates` against `@@unique([pageId, normalizedClaim])`, so a hard
 * delete means the next crawl re-creates the claim the owner just dismissed.
 *
 * `verified` is cleared as well as `rejectedAt` being set. Both public read
 * paths filter on `verified` and neither looks at `rejectedAt`, so rejecting a
 * previously accepted fact without this would leave the rejected claim
 * answering customers.
 */
export async function rejectFact(
  prisma: PrismaClient,
  accountId: string,
  factId: string,
): Promise<void> {
  const rejected = await prisma.fact.updateMany({
    where: { id: factId, page: { accountId } },
    data: { rejectedAt: new Date(), verified: false },
  });

  if (rejected.count !== 1) throw new FactNotFoundError();
}
