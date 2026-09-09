import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { Gateway } from '@curios/gateway';
import { runLeadJob, type MailQueueLike } from './lead.worker.js';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

let leadId = '';

function gatewayReturning(slots: {
  product: string | null;
  date: string | null;
  location: string | null;
}): Gateway {
  return {
    extract: vi.fn(),
    chat: vi.fn(),
    slots: vi.fn().mockResolvedValue(slots),
  };
}

function aMailQueue() {
  return { add: vi.fn<MailQueueLike['add']>(async () => ({ id: 'mail-1' })) };
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
  const account = await prisma.account.create({
    data: {
      email: 'n@example.com',
      pages: {
        create: { handle: 'nadia', skeleton: 'nadia', displayName: 'Nadia Bakes', published: true },
      },
    },
    include: { pages: true },
  });
  const pageId = account.pages[0]?.id ?? '';

  const conversation = await prisma.conversation.create({ data: { pageId } });
  for (const [role, content] of [
    ['USER', 'nak kek butter 2kg'],
    ['ASSISTANT', 'RM160 untuk 2kg.'],
    ['USER', 'hantar Klang boleh?'],
    ['ASSISTANT', 'Boleh.'],
  ] as const) {
    await prisma.message.create({ data: { conversationId: conversation.id, role, content } });
  }

  const lead = await prisma.lead.create({
    data: { pageId, conversationId: conversation.id, phone: '+60123456789' },
  });
  leadId = lead.id;
});

describe('runLeadJob', () => {
  it('fills the slots, scores them, and enqueues one mail', async () => {
    const mailQueue = aMailQueue();
    const gateway = gatewayReturning({
      product: 'kek butter 2kg',
      date: null,
      location: 'Klang',
    });

    await runLeadJob({ prisma, gateway, mailQueue }, { leadId });

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(lead.slots).toMatchObject({ product: 'kek butter 2kg', location: 'Klang' });
    // The score is how many slots came back filled. Not a model opinion -- a
    // number an owner can check by looking at the three fields.
    expect(lead.score).toBe(2);
    expect(mailQueue.add).toHaveBeenCalledOnce();
  });

  it('still sends the mail when extraction fails', async () => {
    // A lead with no slots is worth far more than no lead. The owner has a
    // number and a transcript either way, and that is the product.
    const mailQueue = aMailQueue();
    const failing: Gateway = {
      extract: vi.fn(),
      chat: vi.fn(),
      slots: vi.fn().mockRejectedValue(new Error('provider unavailable')),
    };

    await runLeadJob({ prisma, gateway: failing, mailQueue }, { leadId });

    expect(mailQueue.add).toHaveBeenCalledOnce();
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).score).toBe(0);
  });

  it('addresses the owner and carries the transcript', async () => {
    const mailQueue = aMailQueue();
    const gateway = gatewayReturning({ product: 'kek butter 2kg', date: null, location: 'Klang' });

    await runLeadJob({ prisma, gateway, mailQueue }, { leadId });

    const job = mailQueue.add.mock.calls[0]?.[1];
    expect(job).toMatchObject({ to: 'n@example.com' });
    expect(job?.text).toContain('nak kek butter 2kg');
    expect(job?.text).toContain('https://wa.me/60123456789');
  });

  it('does nothing at all for a lead that has vanished', async () => {
    // BullMQ retries. A lead deleted between the enqueue and the retry must
    // not take the worker down with it.
    const mailQueue = aMailQueue();
    const gateway = gatewayReturning({ product: null, date: null, location: null });

    await expect(runLeadJob({ prisma, gateway, mailQueue }, { leadId: 'gone' })).resolves.toBeUndefined();
    expect(mailQueue.add).not.toHaveBeenCalled();
  });
});
