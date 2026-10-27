import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { defaultSettings } from '@curios/core';
import { captureLead, type LeadQueueLike } from './lead.service.js';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

let pageId = '';
let conversationId = '';

/** Three visitor turns, the last carrying a quantity: a qualifying thread. */
async function aQualifyingConversation(page = pageId): Promise<string> {
  const conversation = await prisma.conversation.create({ data: { pageId: page } });
  for (const [role, content] of [
    ['USER', 'ada kek butter?'],
    ['ASSISTANT', 'Ada, RM95 sekilo.'],
    ['USER', 'yang besar'],
    ['ASSISTANT', 'RM160 untuk 2kg.'],
    ['USER', 'nak 2kg untuk 20 Mac'],
    ['ASSISTANT', 'Boleh.'],
  ] as const) {
    await prisma.message.create({ data: { conversationId: conversation.id, role, content } });
  }
  return conversation.id;
}

/** The settings in force: the defaults, as a database with no rows gives. */
const settings = defaultSettings();

function aQueue() {
  return vi.fn<LeadQueueLike['add']>(async () => ({ id: 'job-1' }));
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
  pageId = account.pages[0]?.id ?? '';
  conversationId = await aQualifyingConversation();
});

describe('captureLead', () => {
  it('counts the trial against the free leads the admin set: with 5, the 4th lead is captured and the 5th is the last free one', async () => {
    const five = { ...settings, freeLeads: 5 };
    await prisma.page.update({ where: { id: pageId }, data: { mode: 'BUSINESS', leadsCaptured: 3 } });
    const fourth = aQueue();
    await captureLead({ prisma, queue: { add: fourth }, settings: five }, { conversationId, phone: '0123456789' });
    expect(fourth.mock.calls[0]?.[1]).not.toHaveProperty('lastFreeLead');

    const fifth = aQueue();
    await captureLead({ prisma, queue: { add: fifth }, settings: five }, { conversationId: await aQualifyingConversation(), phone: '0129999999' });
    expect(fifth.mock.calls[0]?.[1]).toMatchObject({ lastFreeLead: true });
  });

  it('flags the lead that used the last free one, and only that one', async () => {
    await prisma.page.update({ where: { id: pageId }, data: { mode: 'BUSINESS', leadsCaptured: 2 } });
    const add = aQueue();

    await captureLead({ prisma, queue: { add }, settings }, { conversationId, phone: '0123456789' });

    expect(add.mock.calls[0]?.[1]).toMatchObject({ lastFreeLead: true });
  });

  it('does not flag a lead before the last free one, nor one on a paid page', async () => {
    await prisma.page.update({ where: { id: pageId }, data: { mode: 'BUSINESS', leadsCaptured: 1 } });
    const add = aQueue();
    await captureLead({ prisma, queue: { add }, settings }, { conversationId, phone: '0123456789' });
    expect(add.mock.calls[0]?.[1]).not.toHaveProperty('lastFreeLead');

    await prisma.page.update({ where: { id: pageId }, data: { leadsCaptured: 2, paidUntil: new Date('2099-01-01T00:00:00.000Z') } });
    const paid = aQueue();
    await captureLead({ prisma, queue: { add: paid }, settings }, { conversationId: await aQualifyingConversation(), phone: '0129999999' });
    expect(paid.mock.calls[0]?.[1]).not.toHaveProperty('lastFreeLead');
  });

  it('stores the number in one form and queues the extraction', async () => {
    const add = aQueue();

    const { leadId } = await captureLead(
      { prisma, queue: { add }, settings },
      { conversationId, phone: '012-345 6789' },
    );

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(lead.phone).toBe('+60123456789');
    // Null until the job runs. The notification is built from slots, so
    // sending it here would mean sending it twice.
    expect(lead.slots).toBeNull();
    expect(add).toHaveBeenCalledOnce();
  });

  it('refuses a number nobody can dial', async () => {
    const add = aQueue();
    await expect(
      captureLead({ prisma, queue: { add }, settings }, { conversationId, phone: '0323456789' }),
    ).rejects.toMatchObject({ code: 'INVALID_PHONE' });

    expect(await prisma.lead.count()).toBe(0);
    expect(add).not.toHaveBeenCalled();
  });

  it('refuses a conversation that never qualified', async () => {
    // The client is told when to show the card; the client is not trusted to
    // be the thing that decides. Anyone can POST this.
    const browsing = await prisma.conversation.create({ data: { pageId } });
    await prisma.message.create({
      data: { conversationId: browsing.id, role: 'USER', content: 'buka tak?' },
    });
    const add = aQueue();

    await expect(
      captureLead({ prisma, queue: { add }, settings }, { conversationId: browsing.id, phone: '0123456789' }),
    ).rejects.toMatchObject({ code: 'NOT_QUALIFIED' });
  });

  it('allows one capture per conversation and no more', async () => {
    const add = aQueue();
    await captureLead({ prisma, queue: { add }, settings }, { conversationId, phone: '0123456789' });

    await expect(
      captureLead({ prisma, queue: { add }, settings }, { conversationId, phone: '0129999999' }),
    ).rejects.toMatchObject({ code: 'ALREADY_CAPTURED' });

    expect(await prisma.lead.count()).toBe(1);
  });

  it('refuses the same number on the same page within a day', async () => {
    const add = aQueue();
    await captureLead({ prisma, queue: { add }, settings }, { conversationId, phone: '0123456789' });

    // A different conversation, so the per-conversation guard is not what
    // refuses this one -- and a different spelling, so the dedupe is proven to
    // compare stored forms rather than raw input.
    const second = await aQualifyingConversation();
    await expect(
      captureLead({ prisma, queue: { add }, settings }, { conversationId: second, phone: '012-345 6789' }),
    ).rejects.toMatchObject({ code: 'ALREADY_CAPTURED' });
  });

  it('accepts the same number again after the window has passed', async () => {
    const add = aQueue();
    const { leadId } = await captureLead(
      { prisma, queue: { add }, settings },
      { conversationId, phone: '0123456789' },
    );
    // 25 hours ago. Someone who comes back the next day with a new order is a
    // new lead, not a duplicate. Written directly because the alternative is
    // waiting a day or threading a clock through one query to serve one test.
    await prisma.lead.update({
      where: { id: leadId },
      data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    });

    const second = await aQualifyingConversation();
    await expect(
      captureLead({ prisma, queue: { add }, settings }, { conversationId: second, phone: '0123456789' }),
    ).resolves.toMatchObject({ leadId: expect.any(String) });
  });

  it('does not refuse the same number on a different page', async () => {
    const add = aQueue();
    await captureLead({ prisma, queue: { add }, settings }, { conversationId, phone: '0123456789' });

    const other = await prisma.account.create({
      data: {
        email: 'other@example.com',
        pages: {
          create: { handle: 'other', skeleton: 'other', displayName: 'Other', published: true },
        },
      },
      include: { pages: true },
    });
    const theirConversation = await aQualifyingConversation(other.pages[0]?.id ?? '');

    // Dedupe is per page. One customer shopping two bakeries is two leads, and
    // each owner is entitled to their own.
    await expect(
      captureLead(
        { prisma, queue: { add }, settings },
        { conversationId: theirConversation, phone: '0123456789' },
      ),
    ).resolves.toMatchObject({ leadId: expect.any(String) });
  });
});
