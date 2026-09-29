import { syncFactEmbeddings, type PrismaClient } from '@curios/db';
import { FACT_CATEGORIES, normalizeClaim, OWNER_FACT_MAX, type FactCategory } from '@curios/core';
import type { Embedder } from '@curios/embeddings';
import { NoPageError } from '../pages/page.service.js';

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

export class InvalidFactError extends Error {
  readonly statusCode = 400;
  readonly code = 'INVALID_FACT';
  constructor() {
    super(`Write the fact in one line, up to ${OWNER_FACT_MAX} characters, and pick a category.`);
    this.name = 'InvalidFactError';
  }
}

function isFactCategory(value: string): value is FactCategory {
  return (FACT_CATEGORIES as readonly string[]).includes(value);
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
 * Re-embeds one fact. A failure never fails the caller's save: the vector is
 * deleted instead (a stale one is a wrong answer; none is merely fallback),
 * and the failure is logged with an id and the error, never the claim.
 */
async function refreshVector(
  prisma: PrismaClient,
  factId: string,
  embedder: Embedder | null,
  log?: { warn?: (details: object, message: string) => void },
): Promise<void> {
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
 * Rewrites a claim, and the dedupe key with it.
 *
 * `normalizeClaim` is re-run rather than left alone, so the key never drifts
 * from the text it is meant to key. That is also what makes a collision
 * possible here, and a collision is an owner-fixable fact rather than a 500.
 *
 * Since slice 14 an edit also makes the fact the owner's: `origin` becomes
 * OWNER and it is unlinked from its source, so removing that source leaves
 * it. If the wording changed, the old wording is kept as a rejected OWNER
 * row -- the tombstone -- so a re-read of the source cannot bring back what
 * the owner corrected. A rejected row already holding the NEW wording is
 * deleted first: the owner's words override a tombstone (that is also how
 * A -> B -> A works). All of it is one transaction, so a refused edit leaves
 * no tombstone behind.
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
  const before = await prisma.fact.findFirst({
    where: { id: factId, page: { accountId } },
    select: { pageId: true, category: true, claim: true, normalizedClaim: true, question: true },
  });
  if (!before) throw new FactNotFoundError();

  const normalizedClaim = normalizeClaim(claim);
  const reworded = normalizedClaim !== before.normalizedClaim;

  try {
    await prisma.$transaction(async (tx) => {
      if (reworded) {
        await tx.fact.deleteMany({
          where: { pageId: before.pageId, normalizedClaim, rejectedAt: { not: null }, page: { accountId } },
        });
      }
      const updated = await tx.fact.updateMany({
        where: { id: factId, page: { accountId } },
        data: { claim, normalizedClaim, origin: 'OWNER', ingestionId: null },
      });
      if (updated.count !== 1) throw new FactNotFoundError();
      if (reworded) {
        await tx.fact.create({
          data: {
            pageId: before.pageId,
            category: before.category,
            claim: before.claim,
            normalizedClaim: before.normalizedClaim,
            confidence: 0,
            verified: false,
            rejectedAt: new Date(),
            origin: 'OWNER',
          },
        });
      }
    });
  } catch (error) {
    // Checked first: a not-found we raised ourselves must never be handed to
    // isUniqueViolation to classify.
    if (error instanceof FactNotFoundError) throw error;
    if (isUniqueViolation(error)) throw new DuplicateFactError();
    throw error;
  }

  // The vector is of `question ?? claim`. A fact carrying a question is
  // matched on the question, which this function cannot change.
  if (before.question != null) return;
  await refreshVector(prisma, factId, embedder, log);
}

/**
 * A fact the owner typed in. Live at once -- the owner wrote it, which is the
 * explicit human action on one specific fact the hard rule asks for -- and
 * OWNER, so no source's removal touches it.
 *
 * A rejected row holding the same wording is replaced, for the reason
 * `editFact` gives. A live one is a duplicate.
 */
export async function addFact(
  prisma: PrismaClient,
  accountId: string,
  input: { category: string; claim: string },
  embedder: Embedder | null,
  log?: { warn?: (details: object, message: string) => void },
): Promise<{ id: string }> {
  const claim = input.claim.trim();
  if (claim === '' || /[\r\n]/.test(claim) || [...claim].length > OWNER_FACT_MAX || !isFactCategory(input.category)) {
    throw new InvalidFactError();
  }
  const category = input.category;

  const page = await prisma.page.findUnique({ where: { accountId }, select: { id: true } });
  if (!page) throw new NoPageError();

  const normalizedClaim = normalizeClaim(claim);
  let id: string;
  try {
    id = await prisma.$transaction(async (tx) => {
      await tx.fact.deleteMany({ where: { pageId: page.id, normalizedClaim, rejectedAt: { not: null } } });
      const fact = await tx.fact.create({
        data: { pageId: page.id, category, claim, normalizedClaim, confidence: 1, verified: true, origin: 'OWNER' },
        select: { id: true },
      });
      return fact.id;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicateFactError();
    throw error;
  }

  await refreshVector(prisma, id, embedder, log);
  return { id };
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
