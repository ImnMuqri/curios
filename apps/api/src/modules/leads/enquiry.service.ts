import { canCapture, LEAD_QUEUE, normalizeMalaysianPhone } from '@curios/core';
import { ENQUIRY_MESSAGE_MAX, ENQUIRY_NAME_MAX } from '@curios/core/store';
import type { Settings } from '@curios/core/settings';
import { PageUnavailableError } from '../pages/page-unavailable.js';
import { InvalidPhoneError, spentLastFreeLead, type LeadDeps } from './lead.service.js';

/** No such Ask item on this shop now: removed, switched off, made a basket item again, or the shop closed. */
export class EnquiryItemGoneError extends Error {
  readonly statusCode = 404;
  readonly code = 'ITEM_UNAVAILABLE';
  constructor() {
    super('This item isn’t taking enquiries any more.');
    this.name = 'EnquiryItemGoneError';
  }
}

/**
 * The page cannot take a lead now (its plan's leads are used up, or it lapsed). Said as the shop being busy, not
 * why: as with the capture card, the API adds no clearer channel for the owner's billing than the page itself.
 */
export class EnquiriesPausedError extends Error {
  readonly statusCode = 409;
  readonly code = 'ENQUIRIES_PAUSED';
  constructor() {
    super('The shop isn’t taking enquiries right now. Ask on the page instead.');
    this.name = 'EnquiriesPausedError';
  }
}

export class InvalidEnquiryError extends Error {
  readonly statusCode = 400;
  readonly code = 'INVALID_ENQUIRY';
  constructor(message: string) {
    super(message);
    this.name = 'InvalidEnquiryError';
  }
}

export class AlreadyEnquiredError extends Error {
  readonly statusCode = 409;
  readonly code = 'ALREADY_ENQUIRED';
  constructor() {
    super('You already sent an enquiry about this today. The shop will reply on WhatsApp.');
    this.name = 'AlreadyEnquiredError';
  }
}

const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** How the enquiry reads in the conversation, and so in Leads and the owner's email: the Leads board's own words. */
export function enquiryMessage(itemName: string, message: string): string {
  return `Enquiry from the shop: ${itemName}. ${message}`;
}

/**
 * An enquiry from an Ask item's sheet (HANDOFF "Shop: Ask items", 8 Nov 2026): one message, a name and a
 * WhatsApp number. It becomes a conversation holding the message, and a lead on it (kind ENQUIRY), counted
 * against the page's free leads as a chat capture is. The lead job then picks the details out of the
 * message and emails the owner; the customer lands in the page's chat, which asks for the reply.
 *
 * Anonymous, so every guard here is the only guard. One per item per number per day: a second is refused,
 * so a resend does not tell the owner twice; another item is its own enquiry.
 */
export async function sendEnquiry(
  deps: LeadDeps & { settings: Settings },
  input: { handle: string; itemId: string; message: string; name: string; phone: string },
): Promise<{ conversationId: string; leadId: string }> {
  const message = input.message.trim();
  if (message === '' || [...message].length > ENQUIRY_MESSAGE_MAX) throw new InvalidEnquiryError(`Tell them what you need, in up to ${ENQUIRY_MESSAGE_MAX} characters.`);
  const name = input.name.replace(/\s+/g, ' ').trim();
  if (name === '' || [...name].length > ENQUIRY_NAME_MAX) throw new InvalidEnquiryError('Add your name.');
  const phone = normalizeMalaysianPhone(input.phone);
  if (!phone) throw new InvalidPhoneError();

  const page = await deps.prisma.page.findUnique({
    where: { handle: input.handle.toLowerCase() },
    select: { id: true, published: true, suspendedAt: true, mode: true, storeEnabled: true, paidUntil: true, leadsCaptured: true },
  });
  if (!page || !page.published) throw new EnquiryItemGoneError();
  if (page.suspendedAt !== null) throw new PageUnavailableError();
  if (page.mode !== 'BUSINESS' || !page.storeEnabled) throw new EnquiryItemGoneError();

  const item = await deps.prisma.item.findFirst({
    where: { id: input.itemId, pageId: page.id, available: true, askForPrice: true, kind: 'PHYSICAL' },
    select: { id: true, name: true },
  });
  if (!item) throw new EnquiryItemGoneError();

  if (!canCapture({ mode: page.mode, paidUntil: page.paidUntil, leadsCaptured: page.leadsCaptured, now: new Date() }, deps.settings.freeLeads)) {
    throw new EnquiriesPausedError();
  }

  const recent = await deps.prisma.lead.findFirst({
    where: { pageId: page.id, phone, itemId: item.id, kind: 'ENQUIRY', createdAt: { gte: new Date(Date.now() - DEDUPE_WINDOW_MS) } },
    select: { id: true },
  });
  if (recent) throw new AlreadyEnquiredError();

  // One transaction: the conversation, its message, the lead and the count stand or fall together, as captureLead's do.
  const { conversationId, leadId, leadsCaptured } = await deps.prisma.$transaction(async (tx) => {
    const conversation = await tx.conversation.create({
      data: { pageId: page.id, messages: { create: { role: 'USER', content: enquiryMessage(item.name, message) } } },
      select: { id: true },
    });
    const lead = await tx.lead.create({
      data: { pageId: page.id, conversationId: conversation.id, phone, kind: 'ENQUIRY', itemId: item.id, name, note: message },
      select: { id: true },
    });
    const counted = await tx.page.update({ where: { id: page.id }, data: { leadsCaptured: { increment: 1 } }, select: { leadsCaptured: true } });
    return { conversationId: conversation.id, leadId: lead.id, leadsCaptured: counted.leadsCaptured };
  });

  const lastFreeLead = spentLastFreeLead(page, leadsCaptured, deps.settings.freeLeads);
  await deps.queue.add(
    LEAD_QUEUE,
    { leadId, ...(lastFreeLead ? { lastFreeLead: true, freeLeads: deps.settings.freeLeads } : {}) },
    { jobId: leadId, attempts: 3 },
  );

  return { conversationId, leadId };
}
