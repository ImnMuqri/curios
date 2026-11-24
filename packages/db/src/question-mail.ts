import { MAIL_QUEUE, QUESTION_MAIL_ASKS, questionAskedMail, type MailJobData } from '@curios/core';
import type { PrismaClient } from '@prisma/client';

export interface QuestionMailDeps {
  prisma: PrismaClient;
  /** Absent in a deployment or test without mail: nothing is sent and nothing is claimed. */
  mailQueue?: { add(name: string, data: MailJobData, opts?: unknown): Promise<unknown> };
  appUrl: string;
  log?: { warn?: (details: object, message: string) => void };
}

/**
 * Whether the chat answers this topic on its own, by the rule of the Questions screen's "Needs your answer"
 * (chatAnsweredIds in @curios/db-read): no owner answer, and the latest ask the model replied to was
 * one it could answer. Such a topic is not waiting for the owner, so it earns no email.
 */
async function chatAnswers(prisma: PrismaClient, topicId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ answered: boolean }[]>`
    SELECT a."answered"
    FROM "QuestionAsk" a
    JOIN "Question" q ON q."id" = a."questionId"
    WHERE q."topicId" = ${topicId} AND a."reply" IS NOT NULL AND a."answered" IS NOT NULL
    ORDER BY a."askedAt" DESC, a."id" DESC
    LIMIT 1`;
  return rows[0]?.answered === true;
}

/**
 * Tells the owner, once, that a topic has been asked 3 times and is waiting for an answer (Settings,
 * "A question is asked 3 times"). Called after an ask is settled (the chat) and after the grouping job
 * has merged or moved a wording into a topic, because the count reaches 3 in either place.
 *
 * Claimed on the topic itself (askedMailedAt) by a conditional update, so concurrent callers send one
 * email, and a merge keeps the mark (mergeTopics). Only claimed when the switch is on, so an owner who
 * turns it on later hears about a topic that is still being asked. Never throws: the visitor's reply
 * and the grouping job must not fail over an email.
 *
 * `switchedOn` is a hint from a caller that already read the page's switch: false returns before any query.
 */
export async function mailQuestionAsked(deps: QuestionMailDeps, topicId: string, switchedOn?: boolean): Promise<void> {
  if (!deps.mailQueue || switchedOn === false) return;
  try {
    const topic = await deps.prisma.topic.findUnique({
      where: { id: topicId },
      select: {
        title: true,
        askCount: true,
        answer: true,
        conflictAnswer: true,
        askedMailedAt: true,
        page: { select: { displayName: true, notifyQuestions: true, account: { select: { email: true } } } },
      },
    });
    if (!topic || topic.answer !== null || topic.askedMailedAt !== null || topic.askCount < QUESTION_MAIL_ASKS || !topic.page.notifyQuestions) return;
    if (await chatAnswers(deps.prisma, topicId)) return;
    const claim = await deps.prisma.topic.updateMany({ where: { id: topicId, askedMailedAt: null, answer: null }, data: { askedMailedAt: new Date() } });
    if (claim.count === 0) return;
    const mail = questionAskedMail({ title: topic.title, asks: topic.askCount, topicId, appUrl: deps.appUrl, displayName: topic.page.displayName });
    await deps.mailQueue.add(MAIL_QUEUE, { to: topic.page.account.email, ...mail, audience: 'owner' }, { attempts: 5, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true });
  } catch (error) {
    deps.log?.warn?.({ topicId, err: error instanceof Error ? error.message : String(error) }, 'could not queue the question email');
  }
}
