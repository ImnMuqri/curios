import { Worker } from 'bullmq';
import type IORedis from 'ioredis';
import { SUPPORT_INBOUND_QUEUE, type SupportInboundJobData } from '@curios/core';
import { isForSupport, isSpam, newMessageId, parseAddress, threadingIds } from '@curios/core/support';
import type { PrismaClient } from '@curios/db';
import type { PrivateFiles } from '@curios/storage/private-files';
import { QUEUE_CONCURRENCY } from '../queues.js';
import type { ReceivedAttachment, ResendClient } from './resend-client.js';

export interface InboundDeps {
  prisma: PrismaClient;
  resend: ResendClient;
  files: PrivateFiles;
  /** The support address, lower-cased (supportAddress()). */
  support: string;
  log: { info: (details: object, message: string) => void };
}

export type InboundOutcome = 'stored' | 'duplicate' | 'not-support';

/** Deterministic, so a retry overwrites the upload a failed attempt made rather than adding another. */
const storageKey = (emailId: string, attachmentId: string) => `support/${emailId}/${attachmentId}`;

/**
 * Fetch one received email from Resend and file it into a support thread.
 *
 * The attachments go up first and the rows are written last, in one
 * transaction, so a job that fails partway leaves no half-stored message for
 * the admin to see: the retry re-uploads to the same keys and writes it whole.
 * The log carries the email's id and the outcome, never who wrote or what.
 */
export async function processInbound(deps: InboundDeps, emailId: string): Promise<InboundOutcome> {
  const outcome = await fileEmail(deps, emailId);
  deps.log.info({ emailId, outcome }, 'support mail processed');
  return outcome;
}

async function fileEmail(deps: InboundDeps, emailId: string): Promise<InboundOutcome> {
  const { prisma, resend, files } = deps;
  if (await prisma.supportMessage.findUnique({ where: { resendEmailId: emailId }, select: { id: true } })) return 'duplicate';

  const email = await resend.getReceived(emailId);
  if (!isForSupport(email, deps.support)) return 'not-support';

  const attachments = email.attachments.map(normaliseAttachment);
  for (const attachment of attachments) {
    const { stream } = await resend.attachmentStream(emailId, attachment.id);
    await files.put(storageKey(emailId, attachment.id), stream, attachment.content_type, attachment.size);
  }

  const from = parseAddress(email.from);
  // Replies go where Reply-To says, so that is who the thread is with.
  const other = email.reply_to[0] ? parseAddress(email.reply_to[0]) : from;
  const subject = email.subject?.trim() || '(no subject)';
  const spam = isSpam(email.authentication);
  const ids = threadingIds(email.headers);
  const now = new Date();

  try {
    await prisma.$transaction(async (tx) => {
      const earlier = ids.length
        ? await tx.supportMessage.findFirst({
            where: { messageId: { in: ids } },
            orderBy: { createdAt: 'desc' },
            select: { thread: { select: { id: true, status: true } } },
          })
        : null;

      let threadId = earlier?.thread.id;
      if (!threadId) {
        const owner = await tx.account.findFirst({
          where: { email: { equals: other.address, mode: 'insensitive' } },
          select: { id: true },
        });
        const thread = await tx.supportThread.create({
          data: { address: other.address, name: other.name, subject, accountId: owner?.id ?? null, lastMessageAt: now, status: spam ? 'SPAM' : 'OPEN' },
        });
        threadId = thread.id;
      } else {
        await tx.supportThread.update({
          where: { id: threadId },
          // Spam is judged only on the message that starts a thread: a reply in a thread that is
          // not spam reopens it whatever its authentication, and a spam thread stays spam.
          data: {
            status: earlier?.thread.status === 'SPAM' ? 'SPAM' : 'OPEN',
            unread: true,
            lastMessageAt: now,
            ...(other.name ? { name: other.name } : {}),
          },
        });
      }

      await tx.supportMessage.create({
        data: {
          threadId,
          direction: 'IN',
          messageId: email.message_id || newMessageId(),
          resendEmailId: emailId,
          fromAddress: from.address,
          fromName: from.name,
          toAddresses: [...email.to, ...email.cc],
          subject,
          text: email.text,
          html: email.html,
          createdAt: now,
          attachments: {
            create: attachments.map((a) => ({
              resendAttachmentId: a.id,
              fileName: a.filename,
              contentType: a.content_type,
              sizeBytes: a.size,
              contentId: a.content_id ? a.content_id.replace(/^<|>$/g, '') : null,
              inline: a.content_disposition === 'inline',
              storageKey: storageKey(emailId, a.id),
            })),
          },
        },
      });
    });
  } catch (error) {
    // The same email filed by a run that got there first, between the check above and here.
    if (isDuplicateEmail(error)) return 'duplicate';
    throw sanitised(error);
  }
  return 'stored';
}

/**
 * Resend's metadata as the columns need it: a missing name or type, or a size
 * that is not a whole number, would otherwise fail every retry the same way.
 */
function normaliseAttachment(a: ReceivedAttachment): ReceivedAttachment & { filename: string; content_type: string } {
  return {
    ...a,
    filename: a.filename || 'attachment',
    content_type: a.content_type || 'application/octet-stream',
    size: Number.isFinite(a.size) ? Math.trunc(a.size) : 0,
  };
}

/** P2002 on resendEmailId only; Prisma gives the target as the field names or the constraint's name. */
export function isDuplicateEmail(error: unknown): boolean {
  const { code, meta } = (error ?? {}) as { code?: unknown; meta?: { target?: unknown } };
  if (code !== 'P2002') return false;
  const target = meta?.target;
  if (Array.isArray(target)) return target.includes('resendEmailId');
  return typeof target === 'string' && target.includes('resendEmailId');
}

/**
 * A Prisma error's message quotes the whole failed call -- the body, the
 * addresses, the subject -- and the job's error reaches the log, Sentry and
 * BullMQ's failedReason. Only the code or the error's name goes on; the
 * original stays on `cause` for a debugger.
 */
function sanitised(error: unknown): Error {
  const { code, name } = (error ?? {}) as { code?: unknown; name?: unknown };
  const label = typeof code === 'string' ? code : typeof name === 'string' ? name : 'unknown error';
  return new Error(`Filing support mail failed (${label})`, { cause: error });
}

export function createSupportInboundWorker(deps: InboundDeps & { connection: IORedis }): Worker<SupportInboundJobData> {
  const { connection, ...jobDeps } = deps;
  return new Worker<SupportInboundJobData>(SUPPORT_INBOUND_QUEUE, async (job) => processInbound(jobDeps, job.data.emailId), {
    connection,
    concurrency: QUEUE_CONCURRENCY.supportInbound,
  });
}
