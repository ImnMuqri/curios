import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { Gateway } from '@curios/gateway';
import { defaultSettings, type Settings } from '@curios/core/settings';
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
    sameQuestion: async () => {
      throw new Error('not used');
    },
  };
}

/** The workers' settings reader, answering the defaults, or the settings given. */
const reader = (settings: Settings = defaultSettings()) => ({ get: async () => settings });
const settings = reader();

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

    await runLeadJob({ prisma, gateway, mailQueue, settings }, { leadId });

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
      sameQuestion: async () => {
        throw new Error('not used');
      },
    };

    await runLeadJob({ prisma, gateway: failing, mailQueue, settings }, { leadId });

    expect(mailQueue.add).toHaveBeenCalledOnce();
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).score).toBe(0);
  });

  it('addresses the owner and carries the transcript', async () => {
    const mailQueue = aMailQueue();
    const gateway = gatewayReturning({ product: 'kek butter 2kg', date: null, location: 'Klang' });

    await runLeadJob({ prisma, gateway, mailQueue, settings }, { leadId });

    const job = mailQueue.add.mock.calls[0]?.[1];
    // An owner's notification: the admin's "Emails to owners" switch stops it.
    expect(job).toMatchObject({ to: 'n@example.com', audience: 'owner' });
    expect(job?.text).toContain('nak kek butter 2kg');
    expect(job?.text).toContain('https://wa.me/60123456789');
  });

  it('does nothing at all for a lead that has vanished', async () => {
    // BullMQ retries. A lead deleted between the enqueue and the retry must
    // not take the worker down with it.
    const mailQueue = aMailQueue();
    const gateway = gatewayReturning({ product: null, date: null, location: null });

    await expect(runLeadJob({ prisma, gateway, mailQueue, settings }, { leadId: 'gone' })).resolves.toBeUndefined();
    expect(mailQueue.add).not.toHaveBeenCalled();
  });

  it('lays the email out, with the number, the reply button and the conversation', async () => {
    const mailQueue = aMailQueue();
    const gateway = gatewayReturning({ product: 'kek butter 2kg', date: null, location: 'Klang' });

    await runLeadJob({ prisma, gateway, mailQueue, appUrl: 'https://curios.my', settings }, { leadId });

    const html = mailQueue.add.mock.calls[0]?.[1].html ?? '';
    expect(html).toContain('+60 12-345 6789');
    expect(html).toContain('>Reply on WhatsApp</a>');
    expect(html).toContain('href="https://curios.my/app/leads"');
    expect(html).toContain('nak kek butter 2kg');
    expect(html).toContain('Settings, under Notifications');
  });

  it('says which free lead this is on a trial', async () => {
    await prisma.page.updateMany({ data: { mode: 'BUSINESS', leadsCaptured: 2 } });
    const mailQueue = aMailQueue();

    await runLeadJob({ prisma, gateway: gatewayReturning({ product: null, date: null, location: null }), mailQueue, settings }, { leadId });

    expect(mailQueue.add.mock.calls[0]?.[1].html).toContain('Lead 2 of your 3 free leads.');
  });

  it('counts free leads against the allowance in force', async () => {
    await prisma.page.updateMany({ data: { mode: 'BUSINESS', leadsCaptured: 4 } });
    const mailQueue = aMailQueue();

    await runLeadJob({ prisma, gateway: gatewayReturning({ product: null, date: null, location: null }), mailQueue, settings: reader({ ...defaultSettings(), freeLeads: 5 }) }, { leadId });

    expect(mailQueue.add.mock.calls[0]?.[1].html).toContain('Lead 4 of your 5 free leads.');
  });

  it('keeps the lead but sends nothing when the owner switched the email off', async () => {
    await prisma.page.updateMany({ data: { notifyLeads: false } });
    const mailQueue = aMailQueue();
    const gateway = gatewayReturning({ product: 'kek butter 2kg', date: null, location: null });

    await runLeadJob({ prisma, gateway, mailQueue, settings }, { leadId });

    expect(mailQueue.add).not.toHaveBeenCalled();
    // Still filled in and scored: it waits in Leads.
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).score).toBe(1);
  });

  it('also says the page stopped taking numbers when this lead used the last free one, even with the lead email off', async () => {
    await prisma.page.updateMany({ data: { mode: 'BUSINESS', leadsCaptured: 3, notifyLeads: false } });
    const mailQueue = aMailQueue();

    await runLeadJob({ prisma, gateway: gatewayReturning({ product: null, date: null, location: null }), mailQueue, settings }, { leadId, lastFreeLead: true });

    expect(mailQueue.add).toHaveBeenCalledOnce();
    expect(mailQueue.add.mock.calls[0]?.[1]).toMatchObject({ to: 'n@example.com', subject: 'Your page stopped taking numbers', audience: 'owner' });
  });
  it('says the allowance and the prices in force when the trial is used up', async () => {
    await prisma.page.updateMany({ data: { mode: 'BUSINESS', leadsCaptured: 5, notifyLeads: false } });
    const mailQueue = aMailQueue();
    const live = reader({ ...defaultSettings(), freeLeads: 5, prices: { ...defaultSettings().prices, MONTHLY: 5900 } });

    await runLeadJob({ prisma, gateway: gatewayReturning({ product: null, date: null, location: null }), mailQueue, settings: live }, { leadId, lastFreeLead: true });

    const text = mailQueue.add.mock.calls[0]?.[1].text ?? '';
    expect(text).toContain('Your 5 free leads are used');
    expect(text).toContain('Business is RM59 a month');
  });
});
