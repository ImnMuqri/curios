import { LEAD_QUEUE, normalizeMalaysianPhone, qualifies, type LeadJobData } from '@curios/core';
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
      page: { select: { mode: true } },
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

  const lead = await deps.prisma.lead.create({
    data: { pageId: conversation.pageId, conversationId: conversation.id, phone },
    select: { id: true },
  });

  // Slots and the notification are the job's business. Extraction is a model
  // call and nothing generative runs inside a request -- and doing it in that
  // order means the owner never gets a second email correcting the first.
  await deps.queue.add(LEAD_QUEUE, { leadId: lead.id }, { jobId: lead.id, attempts: 3 });

  return { leadId: lead.id };
}
