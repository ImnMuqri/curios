import { ADMIN_ACTIONS, MAIL_QUEUE, planState, type MailJobData } from '@curios/core';
import { newMessageId, referencesFor, replySubject, supportAddress } from '@curios/core/support';
import type { Prisma, PrismaClient, SupportStatus } from '@curios/db';
import type { PrivateFiles } from '../store/private-files.js';
import { writeAudit, type AdminActor } from './audit.js';

export interface AdminSupportDeps {
  prisma: PrismaClient;
  mailQueue: { add(name: string, data: MailJobData, opts?: unknown): Promise<unknown> };
  /** Null: private storage is off, so inline images keep their cid: and attachments cannot be sent. */
  privateFiles: PrivateFiles | null;
  /** The trial's length in force (Settings.freeLeads), for the owner's plan. */
  freeLeads: number;
}

export class SupportNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'SUPPORT_NOT_FOUND';

  constructor() {
    super('That conversation does not exist.');
    this.name = 'SupportNotFoundError';
  }
}

export class NotFailedError extends Error {
  readonly statusCode = 409;
  readonly code = 'NOT_FAILED';

  constructor() {
    super('Only a reply that failed to send can be sent again.');
    this.name = 'NotFailedError';
  }
}

export class ReplyNotQueuedError extends Error {
  readonly statusCode = 500;
  readonly code = 'REPLY_NOT_QUEUED';

  constructor() {
    super('The reply could not be queued, so it was not sent. Send it again from the conversation.');
    this.name = 'ReplyNotQueuedError';
  }
}

export const THREADS_PER_PAGE = 50;
/** An inline image larger than this stays a cid: and is only listed as an attachment. */
export const INLINE_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
/** What one message may inline in total. */
export const INLINE_MESSAGE_MAX_BYTES = 8 * 1024 * 1024;

export type SupportFilter = 'open' | 'done' | 'spam' | 'all';

const OWNER_PAGE_SELECT = {
  id: true,
  handle: true,
  displayName: true,
  mode: true,
  paidUntil: true,
  leadsCaptured: true,
} satisfies Prisma.PageSelect;

const THREAD_SELECT = {
  id: true,
  address: true,
  name: true,
  subject: true,
  status: true,
  unread: true,
  lastMessageAt: true,
  // The account's first page is who the admin sees as the sender's shop.
  account: { select: { pages: { orderBy: { createdAt: 'asc' }, take: 1, select: OWNER_PAGE_SELECT } } },
} satisfies Prisma.SupportThreadSelect;

type ThreadRow = Prisma.SupportThreadGetPayload<{ select: typeof THREAD_SELECT }>;

export interface SupportThreadItem {
  id: string;
  address: string;
  name: string | null;
  subject: string;
  status: SupportStatus;
  unread: boolean;
  lastMessageAt: Date;
  attachmentCount: number;
  owner: { pageId: string; handle: string; displayName: string } | null;
}

function ownerPage(row: ThreadRow) {
  return row.account?.pages[0] ?? null;
}

function toItem(row: ThreadRow, attachmentCount: number): SupportThreadItem {
  const page = ownerPage(row);
  return {
    id: row.id,
    address: row.address,
    name: row.name,
    subject: row.subject,
    status: row.status,
    unread: row.unread,
    lastMessageAt: row.lastMessageAt,
    attachmentCount,
    owner: page ? { pageId: page.id, handle: page.handle, displayName: page.displayName } : null,
  };
}

/** How many files each of these threads carries, in one query. */
async function attachmentCounts(prisma: PrismaClient, threadIds: string[]): Promise<Map<string, number>> {
  const rows = await prisma.supportAttachment.findMany({
    where: { message: { threadId: { in: threadIds } } },
    select: { message: { select: { threadId: true } } },
  });
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.message.threadId, (counts.get(row.message.threadId) ?? 0) + 1);
  return counts;
}

export async function listThreads(
  deps: AdminSupportDeps,
  input: { status: SupportFilter; q?: string; before?: Date },
): Promise<{ threads: SupportThreadItem[]; next: string | null }> {
  const where: Prisma.SupportThreadWhereInput = {};
  if (input.status !== 'all') where.status = input.status.toUpperCase() as SupportStatus;
  const q = input.q?.trim();
  if (q) {
    where.OR = (['address', 'name', 'subject'] as const).map((field) => ({ [field]: { contains: q, mode: 'insensitive' as const } }));
  }
  if (input.before) where.lastMessageAt = { lt: input.before };

  const rows = await deps.prisma.supportThread.findMany({
    where,
    orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
    take: THREADS_PER_PAGE + 1,
    select: THREAD_SELECT,
  });
  const page = rows.slice(0, THREADS_PER_PAGE);
  const last = page[page.length - 1];
  const counts = await attachmentCounts(deps.prisma, page.map((r) => r.id));
  return {
    threads: page.map((r) => toItem(r, counts.get(r.id) ?? 0)),
    next: rows.length > THREADS_PER_PAGE && last ? last.lastMessageAt.toISOString() : null,
  };
}

export async function countThreads(deps: AdminSupportDeps): Promise<{ open: number; done: number; spam: number }> {
  const groups = await deps.prisma.supportThread.groupBy({ by: ['status'], _count: { _all: true } });
  const of = (status: SupportStatus) => groups.find((g) => g.status === status)?._count._all ?? 0;
  return { open: of('OPEN'), done: of('DONE'), spam: of('SPAM') };
}

const MESSAGE_SELECT = {
  id: true,
  direction: true,
  messageId: true,
  subject: true,
  fromAddress: true,
  fromName: true,
  createdAt: true,
  text: true,
  html: true,
  sendStatus: true,
  sentBy: { select: { name: true } },
  attachments: { select: { id: true, fileName: true, contentType: true, sizeBytes: true, contentId: true, inline: true, storageKey: true } },
} satisfies Prisma.SupportMessageSelect;

type MessageRow = Prisma.SupportMessageGetPayload<{ select: typeof MESSAGE_SELECT }>;

/** Mirrors planOf in @curios/db-read/admin (the API does not read through that package). */
function planLabel(page: NonNullable<ReturnType<typeof ownerPage>>, freeLeads: number): string {
  const state = planState({ mode: page.mode, paidUntil: page.paidUntil, leadsCaptured: page.leadsCaptured, now: new Date() }, freeLeads);
  switch (state.kind) {
    case 'personal':
      return 'Personal';
    case 'paid':
      return 'Business';
    case 'trial':
      return state.lapsedOn ? 'Lapsed' : 'Business trial';
    case 'trialSpent':
      return 'Business trial';
    case 'lapsed':
      return 'Lapsed';
  }
}

const CID = /cid:([^"'\s)>]+)/gi;

/**
 * `cid:` references become data: URIs of the stored images, so the admin screen shows them without
 * a second request. Only images within the size limits; the rest keep their cid: and are listed.
 * SVG is left out: it is a document, and it can still be opened from the attachment list.
 */
async function inlineImages(files: PrivateFiles | null, row: MessageRow): Promise<string | null> {
  if (!files || !row.html) return row.html;
  const inlinable = new Map(
    row.attachments
      .filter((a) => a.contentId && /^image\/(?!svg)/i.test(a.contentType) && a.sizeBytes <= INLINE_IMAGE_MAX_BYTES)
      .map((a) => [a.contentId!, a] as const),
  );
  if (inlinable.size === 0) return row.html;

  const uris = new Map<string, string>();
  let total = 0;
  for (const cid of new Set([...row.html.matchAll(CID)].map((m) => m[1]!))) {
    const attachment = inlinable.get(cid);
    if (!attachment || total + attachment.sizeBytes > INLINE_MESSAGE_MAX_BYTES) continue;
    try {
      const bytes = await files.read(attachment.storageKey);
      total += bytes.length;
      uris.set(cid, `data:${attachment.contentType};base64,${bytes.toString('base64')}`);
    } catch {
      // A file that cannot be read keeps its cid:; the rest of the thread still opens.
    }
  }
  return row.html.replace(CID, (whole, cid: string) => uris.get(cid) ?? whole);
}

export interface SupportMessageItem {
  id: string;
  direction: MessageRow['direction'];
  fromAddress: string;
  fromName: string | null;
  createdAt: Date;
  text: string | null;
  html: string | null;
  sendStatus: MessageRow['sendStatus'];
  sentBy: { name: string } | null;
  attachments: { id: string; fileName: string; contentType: string; sizeBytes: number; inline: boolean }[];
}

async function toMessageItem(files: PrivateFiles | null, row: MessageRow): Promise<SupportMessageItem> {
  return {
    id: row.id,
    direction: row.direction,
    fromAddress: row.fromAddress,
    fromName: row.fromName,
    createdAt: row.createdAt,
    text: row.text,
    html: await inlineImages(files, row),
    sendStatus: row.sendStatus,
    sentBy: row.sentBy ? { name: row.sentBy.name } : null,
    attachments: row.attachments.map((a) => ({ id: a.id, fileName: a.fileName, contentType: a.contentType, sizeBytes: a.sizeBytes, inline: a.inline })),
  };
}

export async function getThread(deps: AdminSupportDeps, id: string) {
  const row = await deps.prisma.supportThread.findUnique({
    where: { id },
    select: { ...THREAD_SELECT, messages: { orderBy: { createdAt: 'asc' }, select: MESSAGE_SELECT } },
  });
  if (!row) throw new SupportNotFoundError();
  const page = ownerPage(row);
  const attachmentCount = row.messages.reduce((sum, m) => sum + m.attachments.length, 0);
  return {
    thread: toItem(row, attachmentCount),
    owner: page
      ? { pageId: page.id, handle: page.handle, displayName: page.displayName, plan: planLabel(page, deps.freeLeads), paidUntil: page.paidUntil }
      : null,
    messages: await Promise.all(row.messages.map((m) => toMessageItem(deps.privateFiles, m))),
  };
}

/** The attachment's storage key and name, for the delivery route. Without private storage there is nothing to send. */
export async function findAttachment(deps: AdminSupportDeps, id: string) {
  const attachment = await deps.prisma.supportAttachment.findUnique({
    where: { id },
    select: { fileName: true, sizeBytes: true, storageKey: true },
  });
  if (!attachment || !deps.privateFiles) throw new SupportNotFoundError();
  return attachment;
}

export async function markRead(deps: AdminSupportDeps, id: string): Promise<void> {
  const done = await deps.prisma.supportThread.updateMany({ where: { id }, data: { unread: false } });
  if (done.count === 0) throw new SupportNotFoundError();
}

export async function setStatus(deps: AdminSupportDeps, id: string, status: 'OPEN' | 'DONE'): Promise<void> {
  const done = await deps.prisma.supportThread.updateMany({ where: { id }, data: { status } });
  if (done.count === 0) throw new SupportNotFoundError();
}

const MAIL_OPTIONS = { attempts: 5, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true };

interface Threading {
  inReplyTo: string | undefined;
  references: string[];
}

/** What a reply threads under: the thread's messages oldest first, up to (not including) `before`. */
async function threading(prisma: PrismaClient | Prisma.TransactionClient, threadId: string, before?: Date): Promise<Threading> {
  const earlier = await prisma.supportMessage.findMany({
    where: { threadId, ...(before ? { createdAt: { lt: before } } : {}) },
    orderBy: { createdAt: 'asc' },
    select: { direction: true, messageId: true },
  });
  const lastIn = [...earlier].reverse().find((m) => m.direction === 'IN');
  return { inReplyTo: lastIn?.messageId, references: referencesFor(earlier.map((m) => m.messageId)) };
}

/** After the message is stored; a queue that is down marks it FAILED so the admin can send it again. */
async function queueSend(
  deps: AdminSupportDeps,
  message: { id: string; messageId: string; subject: string; text: string | null },
  to: string,
  threads: Threading,
): Promise<void> {
  try {
    await deps.mailQueue.add(
      MAIL_QUEUE,
      {
        to,
        from: 'support',
        subject: message.subject,
        text: message.text ?? '',
        messageId: message.messageId,
        ...(threads.inReplyTo ? { inReplyTo: threads.inReplyTo } : {}),
        references: threads.references,
        supportMessageId: message.id,
      },
      MAIL_OPTIONS,
    );
  } catch {
    await deps.prisma.supportMessage.updateMany({ where: { id: message.id }, data: { sendStatus: 'FAILED' } });
    throw new ReplyNotQueuedError();
  }
}

export async function reply(deps: AdminSupportDeps, actor: AdminActor, threadId: string, text: string) {
  const { message, address, prior } = await deps.prisma.$transaction(async (tx) => {
    const thread = await tx.supportThread.findUnique({ where: { id: threadId }, select: { address: true, subject: true } });
    if (!thread) throw new SupportNotFoundError();
    const earlier = await threading(tx, threadId);
    const now = new Date();
    const created = await tx.supportMessage.create({
      data: {
        threadId,
        direction: 'OUT',
        messageId: newMessageId(),
        fromAddress: supportAddress(),
        fromName: 'Curios Support',
        toAddresses: [thread.address],
        subject: replySubject(thread.subject),
        text,
        sendStatus: 'SENDING',
        sentById: actor.adminId,
        createdAt: now,
      },
      select: MESSAGE_SELECT,
    });
    await tx.supportThread.update({ where: { id: threadId }, data: { lastMessageAt: now } });
    // No body: the audit table records that a reply went, never what it said.
    await writeAudit(tx, {
      adminUserId: actor.adminId,
      action: ADMIN_ACTIONS.REPLIED_SUPPORT,
      targetType: 'SupportThread',
      targetId: threadId,
      targetLabel: thread.address,
      reason: '',
      metadata: { subject: thread.subject },
      ip: actor.ip,
    });
    return { message: created, address: thread.address, prior: earlier };
  });
  await queueSend(deps, { id: message.id, messageId: message.messageId, subject: message.subject, text }, address, prior);
  return { message: await toMessageItem(deps.privateFiles, message) };
}

export async function retry(deps: AdminSupportDeps, id: string): Promise<void> {
  const message = await deps.prisma.supportMessage.findUnique({
    where: { id },
    select: { id: true, direction: true, messageId: true, subject: true, text: true, createdAt: true, thread: { select: { id: true, address: true } } },
  });
  if (!message || message.direction !== 'OUT') throw new SupportNotFoundError();
  // Conditional, so two clicks queue one send.
  const claimed = await deps.prisma.supportMessage.updateMany({ where: { id, sendStatus: 'FAILED' }, data: { sendStatus: 'SENDING' } });
  if (claimed.count === 0) throw new NotFailedError();
  await queueSend(deps, message, message.thread.address, await threading(deps.prisma, message.thread.id, message.createdAt));
}
