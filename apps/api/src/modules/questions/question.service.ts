import type { PrismaClient } from '@curios/db';
import { assignFaqSlug } from './faq-slug.js';

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
  await assignFaqSlug(prisma, question.id);
}
