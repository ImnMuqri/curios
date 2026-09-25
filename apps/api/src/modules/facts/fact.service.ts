import { syncFactEmbeddings, type PrismaClient } from '@curios/db';
import { normalizeClaim } from '@curios/core';
import type { Embedder } from '@curios/embeddings';

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
  // No assertion on `code`: the `in` check narrows it. Matches the identical
  // helper in auth.service.ts, and the linter rejects the cast anyway.
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
 *
 * The fact's vector is handled last, and only when it can be stale. A vector
 * is of `question ?? claim`: a fact carrying a question is matched on that
 * question, which this function cannot change, so its vector is still
 * correct and re-embedding it would write the same numbers back. A fact with
 * no question is matched on its claim, which just changed, so it is
 * re-embedded.
 *
 * NOTE for whoever adds an edit-the-question path: that one must re-embed
 * unconditionally. The condition below is not "we can skip this sometimes",
 * it is "this path cannot change what was embedded".
 *
 * A failure to embed never fails the save. The edit is already committed, and
 * an owner watching a spinner does not care which vendor is down. The row is
 * deleted instead: a stale vector matches wording the claim no longer has,
 * which is a wrong answer, and no vector puts the page into fallback, which
 * is merely an expensive right one.
 *
 * The failure is also logged -- an id and the error only, never the claim.
 * `syncFactEmbeddings` deliberately does not log ("a caller decides whether a
 * failure to embed is fatal"), so this catch is the one place in the system
 * an embedding outage during an owner's edit becomes visible to anyone.
 */
export async function editFact(
  prisma: PrismaClient,
  accountId: string,
  factId: string,
  claim: string,
  embedder: Embedder | null,
  log?: { warn?: (details: object, message: string) => void },
): Promise<void> {
  let updated;
  try {
    updated = await prisma.fact.updateMany({
      where: { id: factId, page: { accountId } },
      data: { claim, normalizedClaim: normalizeClaim(claim) },
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicateFactError();
    throw error;
  }

  // Thrown OUTSIDE the catch above, deliberately. Inside it, a not-found we
  // raised ourselves would be handed to `isUniqueViolation` to classify, and
  // the two would only stay distinct for as long as their `code` values happen
  // to differ. It is also thrown before any embedding work, so a refused edit
  // never spends a call or touches a vector.
  if (updated.count !== 1) throw new FactNotFoundError();

  const fact = await prisma.fact.findUnique({
    where: { id: factId },
    select: { question: true },
  });
  if (fact?.question != null) return;

  try {
    if (!embedder) throw new Error('no embedder is configured');
    // Deleted first, so that a crash between the two leaves no vector rather
    // than a stale one: the failure that costs money is always the safer one.
    await prisma.factEmbedding.deleteMany({ where: { factId } });
    await syncFactEmbeddings(prisma, embedder, { id: factId });
  } catch (error) {
    await prisma.factEmbedding.deleteMany({ where: { factId } });
    log?.warn?.(
      { factId, err: error instanceof Error ? error.message : String(error) },
      'fact edited but its vector could not be refreshed; this page falls back until a backfill runs',
    );
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
