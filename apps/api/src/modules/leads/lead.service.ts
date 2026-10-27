import {
  canCapture,
  LEAD_QUEUE,
  normalizeMalaysianPhone,
  planState,
  qualifies,
  type LeadJobData,
} from '@curios/core';
import type { PrismaClient } from '@curios/db';
import type { Settings } from '@curios/core/settings';
import { PageUnavailableError } from '../pages/page-unavailable.js';

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
  /** `settings`: the admin's, read per request; the trial is `settings.freeLeads` long. */
  deps: LeadDeps & { settings: Settings },
  input: { conversationId: string; phone: string },
): Promise<{ leadId: string }> {
  const phone = normalizeMalaysianPhone(input.phone);
  if (!phone) throw new InvalidPhoneError();

  const conversation = await deps.prisma.conversation.findUnique({
    where: { id: input.conversationId },
    select: {
      id: true,
      pageId: true,
      page: { select: { mode: true, paidUntil: true, leadsCaptured: true, suspendedAt: true } },
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
  // A suspended page keeps no new leads. Said plainly: the visitor already has the page's own 410 on every other surface.
  if (conversation.page.suspendedAt !== null) throw new PageUnavailableError();
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
  }, deps.settings.freeLeads);
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

  // Whether this lead used the last free one: its own increment took the page from
  // trial to trialSpent under the allowance this request decided with. The count
  // before and after are both this increment's, read back from it, so two captures
  // at once never both claim it, whatever the allowance: under a lowered one too, the
  // capture whose count first reaches it is the one. A paid page is not on the
  // trial, and a lapsed one goes to lapsed rather than trialSpent: neither qualifies.
  //
  // An allowance lowered to or below a page's count already turns its card off, so
  // no capture follows to tell the owner; Billing and the dashboard say it instead.
  const stateAt = (leadsCaptured: number) =>
    planState({ mode: conversation.page.mode, paidUntil: conversation.page.paidUntil, leadsCaptured, now: new Date() }, deps.settings.freeLeads).kind;
  const lastFreeLead = stateAt(counted.leadsCaptured - 1) === 'trial' && stateAt(counted.leadsCaptured) === 'trialSpent';

  // Slots and the notification are the job's business. Extraction is a model
  // call and nothing generative runs inside a request -- and doing it in that
  // order means the owner never gets a second email correcting the first.
  await deps.queue.add(
    LEAD_QUEUE,
    { leadId: lead.id, ...(lastFreeLead ? { lastFreeLead: true, freeLeads: deps.settings.freeLeads } : {}) },
    { jobId: lead.id, attempts: 3 },
  );

  return { leadId: lead.id };
}

/**
 * BACKEND.md's owner-facing delete, per lead.
 *
 * Scoped in the query rather than checked after the read. Every ownership
 * check in this codebase has that shape, and this is the one where getting it
 * wrong destroys another owner's data rather than merely showing it.
 *
 * The scope sits on the DELETE itself, not only on the read before it, so the
 * guard cannot be separated from the thing it guards by a later edit; the read
 * is there to learn which conversation's transcript goes with it.
 *
 * The transcript goes with it (PDPA, decided 2026-10-26): a visitor's chat is free text, and a
 * phone number typed into it ("wasap saya 012-345 6789") sits in `Message.content`, which the
 * transcript drawer renders back verbatim. So the conversation's messages are deleted in the same
 * transaction, and only a lead this owner holds can reach them. The Conversation row stays, empty,
 * and the retention sweep takes it at twelve months like any other emptied conversation. The
 * questions screen is unchanged: its counts live on `Question`, which points at no message. `Question.text` and `Topic.title`
 * never held the number: chat blanks contact details before it keeps a wording
 * (`withoutContactDetails`).
 */
export async function deleteLead(
  prisma: PrismaClient,
  accountId: string,
  leadId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const lead = await tx.lead.findFirst({ where: { id: leadId, page: { accountId } }, select: { conversationId: true } });
    if (!lead) throw new LeadNotYoursError();
    const { count } = await tx.lead.deleteMany({ where: { id: leadId, page: { accountId } } });
    if (count === 0) throw new LeadNotYoursError();
    await tx.message.deleteMany({ where: { conversationId: lead.conversationId } });
  });
}

/**
 * Where the owner is with a lead: NEW until they reach out, CONTACTED once
 * they have, then SOLD if it became a sale or CLOSED if it simply ended. Scoped through the owner in the
 * query, like deleteLead, and a 404 for anyone else's.
 */
export async function setLeadStatus(
  prisma: PrismaClient,
  accountId: string,
  leadId: string,
  status: 'NEW' | 'CONTACTED' | 'SOLD' | 'CLOSED',
): Promise<void> {
  const { count } = await prisma.lead.updateMany({
    where: { id: leadId, page: { accountId } },
    data: { status },
  });
  if (count === 0) throw new LeadNotYoursError();
}
