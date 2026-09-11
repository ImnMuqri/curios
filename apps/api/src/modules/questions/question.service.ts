import type { PrismaClient } from '@curios/db';
import { assignFaqSlug, type Log } from './faq-slug.js';

export class QuestionNotYoursError extends Error {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
  constructor() {
    // 404, not 403. A 403 confirms the id exists, which is itself a leak --
    // the same reasoning as PageNotYoursError in the ingest service.
    super('No such question.');
    this.name = 'QuestionNotYoursError';
  }
}

/**
 * The writeback, and the one thing the questions screen is for.
 *
 * A PinnedAnswer on the same normalised key `chat.service.ts` already checks
 * before calling the model -- so the next person to ask gets the owner's exact
 * words, at zero tokens and with no chance of a paraphrase.
 *
 * Matching is exact on that key. Answering "berapa harga kek" does not cover
 * "harga kek berapa", which falls through to the model and its facts. That is
 * a known limit, argued in devDocs/slice-5-build-spec.md, and not a bug to be
 * fixed by loosening the key -- the fact dedupe and the pinned lookup share
 * it, so loosening it here loosens all three.
 */
export async function answerQuestion(
  prisma: PrismaClient,
  accountId: string,
  questionId: string,
  answer: string,
  // Optional, and only for the faq-slug writeback below: without it, a
  // qualifying question that fails to get a URL -- an exhausted collision
  // loop, unsluggable text, a transient DB error -- leaves no trace anywhere,
  // which is exactly what assignFaqSlug's `log` parameter exists to prevent.
  log?: Log,
): Promise<void> {
  // Scoped in the query, not filtered after the read. A read-then-check leaks
  // through timing and is one careless early return away from writing into a
  // stranger's page.
  const question = await prisma.question.findFirst({
    where: { id: questionId, page: { accountId } },
    select: { id: true, pageId: true, text: true, normalizedQuestion: true },
  });
  if (!question) throw new QuestionNotYoursError();

  // One transaction: a pinned answer without its question marked answered
  // would reappear at the top of the screen as unanswered, and an owner would
  // write it twice.
  await prisma.$transaction([
    prisma.pinnedAnswer.upsert({
      where: {
        pageId_normalizedQuestion: {
          pageId: question.pageId,
          normalizedQuestion: question.normalizedQuestion,
        },
      },
      create: {
        pageId: question.pageId,
        question: question.text,
        normalizedQuestion: question.normalizedQuestion,
        answer,
      },
      // An owner fixing a typo must not hit the unique constraint.
      update: { answer },
    }),
    prisma.question.update({ where: { id: question.id }, data: { answered: true } }),
  ]);

  // After the transaction, not inside it. The answer is the owner's work and
  // must commit whatever happens to the URL; the slug is a consequence of it.
  await assignFaqSlug(prisma, question.id, log);
}

/**
 * Take a published question off the public FAQ, or put it back.
 *
 * A flag, not a delete, and the distinction is load-bearing: `chat.service.ts`
 * upserts questions keyed on `(pageId, normalizedQuestion)`, so a deleted row
 * is recreated the next time anybody asks the same thing. A takedown that
 * quietly undoes itself is worse than none, because the owner believes it
 * worked.
 *
 * The slug and the answer both survive. The owner said "not public", not "not
 * true" -- chat keeps answering from it, and the URL stays reserved so it can
 * never be handed to a different question later.
 *
 * Scoped in the statement rather than after a read, the same reasoning as
 * `deleteLead`: a read-then-write is one careless early return away from
 * writing into a stranger's page.
 */
export async function setFaqSuppressed(
  prisma: PrismaClient,
  accountId: string,
  questionId: string,
  suppressed: boolean,
): Promise<void> {
  const { count } = await prisma.question.updateMany({
    where: { id: questionId, page: { accountId } },
    data: { faqSuppressed: suppressed },
  });
  if (count === 0) throw new QuestionNotYoursError();
}

/**
 * Erase a question and the answer written to it.
 *
 * This is the right-to-erasure primitive, and it is a different act from
 * suppression: `Question.text` is a customer's own words, so when those words
 * are the problem -- a phone number, an address, somebody else's name -- hiding
 * the page is not enough.
 *
 * The `PinnedAnswer` goes with it. Leaving it behind would keep the same
 * content reachable through chat under the same normalised key, which is
 * erasure that erases nothing.
 *
 * The read locates the answer, which has no relation to walk; but BOTH deletes
 * carry `page: { accountId }` independently, so the scope is enforced by each
 * statement rather than inherited from the lookup that preceded it.
 */
export async function deleteQuestion(
  prisma: PrismaClient,
  accountId: string,
  questionId: string,
): Promise<void> {
  const question = await prisma.question.findFirst({
    where: { id: questionId, page: { accountId } },
    select: { id: true, pageId: true, normalizedQuestion: true },
  });
  if (!question) throw new QuestionNotYoursError();

  await prisma.$transaction([
    prisma.pinnedAnswer.deleteMany({
      where: {
        pageId: question.pageId,
        normalizedQuestion: question.normalizedQuestion,
        page: { accountId },
      },
    }),
    prisma.question.deleteMany({ where: { id: question.id, page: { accountId } } }),
  ]);
}
