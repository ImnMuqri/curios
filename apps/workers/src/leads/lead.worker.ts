import { Worker } from 'bullmq';
import type IORedis from 'ioredis';
import { FREE_LEADS, LEAD_QUEUE, MAIL_QUEUE, planState, type LeadJobData, type MailJobData } from '@curios/core';
import type { PrismaClient } from '@curios/db';
import type { Gateway } from '@curios/gateway';
import { QUEUE_CONCURRENCY } from '../queues.js';
import { buildNotification, type LeadSlots } from './notify.js';

export interface MailQueueLike {
  add(name: string, data: MailJobData, opts?: unknown): Promise<{ id?: string }>;
}

export interface LeadJobDeps {
  prisma: PrismaClient;
  gateway: Gateway;
  mailQueue: MailQueueLike;
  /** The dashboard's address, for the email's "See in Leads". */
  appUrl?: string;
  log?: { warn: (details: object, message: string) => void };
}

const NO_SLOTS: LeadSlots = { product: null, date: null, location: null };

/**
 * Fill in what the customer asked for, then tell the owner.
 *
 * In that order, and it matters: the notification is built from the slots, so
 * sending first would mean sending twice -- once with a bare number and again
 * to correct it. An owner who receives two emails about one lead stops reading
 * either carefully.
 */
export async function runLeadJob(deps: LeadJobDeps, data: LeadJobData): Promise<void> {
  const lead = await deps.prisma.lead.findUnique({
    where: { id: data.leadId },
    select: {
      id: true,
      phone: true,
      createdAt: true,
      page: {
        select: {
          displayName: true,
          notifyLeads: true,
          mode: true,
          paidUntil: true,
          leadsCaptured: true,
          account: { select: { email: true } },
        },
      },
      conversation: {
        select: {
          messages: { select: { role: true, content: true }, orderBy: { createdAt: 'asc' } },
        },
      },
    },
  });
  // BullMQ retries, and a lead deleted between the enqueue and the retry must
  // not take the worker down with it.
  if (!lead) return;

  const transcript = lead.conversation.messages;
  const attributed = transcript
    .map((line) => `${line.role === 'USER' ? 'Customer' : lead.page.displayName}: ${line.content}`)
    .join('\n');

  let slots: LeadSlots = NO_SLOTS;
  try {
    slots = await deps.gateway.slots({ transcript: attributed });
  } catch (error) {
    // Swallowed on purpose. A lead with no slots is worth far more than no
    // lead: the owner still gets a number and the whole conversation, which is
    // the product. Letting this throw would retry the job and eventually drop
    // the notification entirely.
    deps.log?.warn(
      { leadId: lead.id, err: error instanceof Error ? error.message : String(error) },
      'slot extraction failed; sending the lead without slots',
    );
  }

  // The score is the count of filled slots. BACKEND.md is deliberate about
  // this: a number an owner can verify by looking at three fields beats one
  // they have to trust.
  const score = [slots.product, slots.date, slots.location].filter(Boolean).length;

  await deps.prisma.lead.update({
    where: { id: lead.id },
    // Spread into a plain object: Prisma's Json input type does not accept a
    // declared interface, only its own structural JSON type.
    data: { slots: { ...slots }, score },
  });

  // Switched off in Settings ("Email me when"): the lead is saved and
  // scored above, and waits in Leads; only the email is skipped.
  if (!lead.page.notifyLeads) return;

  // On a free trial, which free lead this is, so the email can say how many
  // are left before the capture card stops.
  const plan = planState({ mode: lead.page.mode, paidUntil: lead.page.paidUntil, leadsCaptured: lead.page.leadsCaptured, now: new Date() });
  const onTrial = plan.kind === 'trial' || plan.kind === 'trialSpent';

  const mail = buildNotification({
    displayName: lead.page.displayName,
    phone: lead.phone,
    transcript,
    slots,
    appUrl: deps.appUrl,
    leftAt: lead.createdAt,
    freeLead: onTrial ? { nth: Math.min(lead.page.leadsCaptured, FREE_LEADS), of: FREE_LEADS } : null,
  });
  await deps.mailQueue.add(MAIL_QUEUE, {
    to: lead.page.account.email,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });
}

export function createLeadWorker(deps: {
  connection: IORedis;
  prisma: PrismaClient;
  gateway: Gateway;
  mailQueue: MailQueueLike;
  appUrl?: string;
  log?: { warn: (details: object, message: string) => void };
}): Worker<LeadJobData> {
  return new Worker<LeadJobData>(
    LEAD_QUEUE,
    async (job) =>
      runLeadJob(
        {
          prisma: deps.prisma,
          gateway: deps.gateway,
          mailQueue: deps.mailQueue,
          appUrl: deps.appUrl,
          log: deps.log,
        },
        job.data,
      ),
    { connection: deps.connection, concurrency: QUEUE_CONCURRENCY.mail },
  );
}
