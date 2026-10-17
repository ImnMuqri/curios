import {
  canCapture,
  FREE_LEADS,
  LEAD_QUEUE,
  normalizeMalaysianPhone,
  planState,
  qualifies,
  type LeadJobData,
} from '@curios/core';
import type { PrismaClient } from '@curios/db';

export interface LeadQueueLike {
  add(name: string, data: LeadJobData, opts?: unknown): Promise<{ id?: string }>;
}

export interface LeadDeps {
  prisma: PrismaClient;
  queue: LeadQueueLike;
}

export class InvalidPhoneError extends Error {
  readonly statusCode = 400;
  readonly code = 'INVALID_PHONE';
  constructor() {
    super('That does not look like a Malaysian mobile number. Try 012-345 6789.');
    this.name = 'InvalidPhoneError';
  }
}

export class NotQualifiedError extends Error {
  readonly statusCode = 400;
  readonly code = 'NOT_QUALIFIED';
  constructor() {
    super('Keep chatting first, then we can pass your number on.');
    this.name = 'NotQualifiedError';
  }
}

export class AlreadyCapturedError extends Error {
  readonly statusCode = 409;
  readonly code = 'ALREADY_CAPTURED';
  constructor() {
    super('Your number is already with the shop. They will be in touch.');
    this.name = 'AlreadyCapturedError';
  }
}

export class LeadNotYoursError extends Error {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
  constructor() {
    // 404, not 403: a 403 confirms the id exists. The same shape as
    // PageNotYoursError and QuestionNotYoursError.
    super('No such lead.');
    this.name = 'LeadNotYoursError';
  }
}

const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Anonymous, so every guard here is the only guard.
 *
 * The client is told when to offer the card, and the client is not trusted to
 * be the thing that decides: anyone can POST this route, so qualification is
 * re-checked against the stored conversation rather than taken on the caller's
 * word. The same reasoning as `verified: true` on the read paths -- the
 * server's copy of the rule is the one that counts.
 */
export async function captureLead(
  deps: LeadDeps,
  input: { conversationId: string; phone: string },
): Promise<{ leadId: string }> {
  const phone = normalizeMalaysianPhone(input.phone);
  if (!phone) throw new InvalidPhoneError();

  const conversation = await deps.prisma.conversation.findUnique({
    where: { id: input.conversationId },
    select: {
      id: true,
      pageId: true,
      page: { select: { mode: true, paidUntil: true, leadsCaptured: true } },
      lead: { select: { id: true } },
      messages: {
        where: { role: 'USER' },
        select: { content: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  // An unknown conversation is not qualified, and saying so rather than "no
  // such conversation" keeps this endpoint from confirming which ids exist.
  if (!conversation) throw new NotQualifiedError();
  if (conversation.lead) throw new AlreadyCapturedError();

  const eligible = qualifies({
    mode: conversation.page.mode,
    visitorMessages: conversation.messages.map((message) => message.content),
  });
  if (!eligible) throw new NotQualifiedError();

  // The plan gate, and deliberately the same error as the qualification gate
  // above. A distinguishable "you have not paid" would make this endpoint an
  // oracle for the owner's billing status, and it takes no session.
  //
  // It does not make that status secret, and nothing here can. The public page
  // omits the capture card when this rule is false, so the card's absence is
  // the signal -- readable from one anonymous GET, since `canCapture` is a
  // client-component prop and rides in the RSC payload. Any UI that changes
  // with payment status discloses payment status. What this line buys is that
  // the API adds no second channel and no clearer one: it stays no more
  // informative than the page a visitor can already load.
  const allowed = canCapture({
    mode: conversation.page.mode,
    paidUntil: conversation.page.paidUntil,
    leadsCaptured: conversation.page.leadsCaptured,
    now: new Date(),
  });
  if (!allowed) throw new NotQualifiedError();

  // Per page, per 24 hours. A window cannot be a unique index, so this is a
  // query -- and it is per page on purpose: one customer shopping two bakeries
  // is two leads, and each owner is entitled to their own.
  const recent = await deps.prisma.lead.findFirst({
    where: {
      pageId: conversation.pageId,
      phone,
      createdAt: { gte: new Date(Date.now() - DEDUPE_WINDOW_MS) },
    },
    select: { id: true },
  });
  if (recent) throw new AlreadyCapturedError();

  // One transaction. The counter is what the trial is measured against, so a
  // stored lead that was never counted is a free fourth lead, and a count
  // without a lead spends a page's trial on nothing.
  const [lead, counted] = await deps.prisma.$transaction([
    deps.prisma.lead.create({
      data: { pageId: conversation.pageId, conversationId: conversation.id, phone },
      select: { id: true },
    }),
    deps.prisma.page.update({
      where: { id: conversation.pageId },
      data: { leadsCaptured: { increment: 1 } },
      select: { leadsCaptured: true },
    }),
  ]);

  // Whether this lead used the last free one: the count it produced, read
  // back from the same increment, so two captures at once cannot both claim
  // it. A paid page is not on the trial, so it never qualifies.
  const lastFreeLead =
    counted.leadsCaptured === FREE_LEADS &&
    planState({ mode: conversation.page.mode, paidUntil: conversation.page.paidUntil, leadsCaptured: counted.leadsCaptured, now: new Date() }).kind === 'trialSpent';

  // Slots and the notification are the job's business. Extraction is a model
  // call and nothing generative runs inside a request -- and doing it in that
  // order means the owner never gets a second email correcting the first.
  await deps.queue.add(LEAD_QUEUE, { leadId: lead.id, ...(lastFreeLead ? { lastFreeLead: true } : {}) }, { jobId: lead.id, attempts: 3 });

  return { leadId: lead.id };
}

/**
 * BACKEND.md's owner-facing delete, per lead.
 *
 * Scoped in the query rather than checked after the read. Every ownership
 * check in this codebase has that shape, and this is the one where getting it
 * wrong destroys another owner's data rather than merely showing it.
 *
 * The scope sits on the DELETE itself rather than on a findFirst before it,
 * which is where this differs from `answerQuestion`. One statement instead of
 * two, and the guard cannot be separated from the thing it guards by a later
 * edit. This is not fixing an observed race: a concurrent double delete was
 * measured against the two-step version and it returned a clean 404 both
 * times, because the pool serialises the pair. It is one irreversible
 * statement carrying its own scope.
 *
 * The Conversation is left alone deliberately. The lead is the personal data;
 * the conversation is a visitor's chat with a public page, and it feeds the
 * questions screen -- cascading into it would silently rewrite an owner's own
 * ask counts as a side effect of clearing one phone number.
 *
 * What this actually erases: the Lead row, and nothing else -- no Message, no
 * Question, no Conversation. That matters because a visitor's chat is free
 * text, and a phone number typed into the chat itself ("wasap saya 012-345
 * 6789") lands in `Message.content`, which the leads screen's transcript
 * drawer renders back to the owner verbatim; `Question.text` keeps whatever a
 * visitor typed just as literally. Deleting the Lead does not touch either.
 * So an owner who deletes a lead to honour an erasure request has cleared the
 * one row this function is scoped to and no more -- a number can still
 * survive in Message or Question rows. This function is a targeted delete,
 * not a right-to-erasure primitive; treat it as the former.
 */
export async function deleteLead(
  prisma: PrismaClient,
  accountId: string,
  leadId: string,
): Promise<void> {
  const { count } = await prisma.lead.deleteMany({
    where: { id: leadId, page: { accountId } },
  });
  if (count === 0) throw new LeadNotYoursError();
}

/**
 * Where the owner is with a lead: NEW until they reach out, CONTACTED once
 * they have, CLOSED when it is done with. Scoped through the owner in the
 * query, like deleteLead, and a 404 for anyone else's.
 */
export async function setLeadStatus(
  prisma: PrismaClient,
  accountId: string,
  leadId: string,
  status: 'NEW' | 'CONTACTED' | 'CLOSED',
): Promise<void> {
  const { count } = await prisma.lead.updateMany({
    where: { id: leadId, page: { accountId } },
    data: { status },
  });
  if (count === 0) throw new LeadNotYoursError();
}
