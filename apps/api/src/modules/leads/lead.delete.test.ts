import { beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { deleteLead } from './lead.service.js';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

let accountId = '';
let strangerAccountId = '';
let leadId = '';

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "Account" CASCADE');

  const account = await prisma.account.create({
    data: {
      email: 'f@example.com',
      pages: {
        create: { handle: 'faridah', skeleton: 'faridah', displayName: 'Faridah Bakes' },
      },
    },
    include: { pages: true },
  });
  accountId = account.id;
  const pageId = account.pages[0]?.id ?? '';

  const conversation = await prisma.conversation.create({ data: { pageId } });
  // Two messages, so the test below can prove they survive the delete rather
  // than asserting zero and passing because none were ever created.
  for (const [role, content] of [
    ['USER', 'nak kek butter 2kg'],
    ['ASSISTANT', 'RM160 untuk 2kg.'],
  ] as const) {
    await prisma.message.create({ data: { conversationId: conversation.id, role, content } });
  }
  const lead = await prisma.lead.create({
    data: { pageId, conversationId: conversation.id, phone: '+60123456789' },
  });
  leadId = lead.id;

  const stranger = await prisma.account.create({ data: { email: 'intruder@example.com' } });
  strangerAccountId = stranger.id;
});

describe('deleteLead', () => {
  it('removes the lead', async () => {
    await deleteLead(prisma, accountId, leadId);
    expect(await prisma.lead.count()).toBe(0);
  });

  it('leaves the conversation alone', async () => {
    // The lead is the personal data. The conversation is a visitor's chat with
    // a public page and it feeds the questions screen -- deleting it would
    // quietly rewrite an owner's own ask counts as a side effect of clearing
    // one phone number.
    await deleteLead(prisma, accountId, leadId);
    expect(await prisma.conversation.count()).toBe(1);
    expect(await prisma.message.count()).toBe(2);
  });

  it('refuses a lead belonging to someone else', async () => {
    // 404, not 403. And this one matters more than the read: a broken scope
    // here destroys another owner's data rather than merely showing it.
    await expect(deleteLead(prisma, strangerAccountId, leadId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await prisma.lead.count()).toBe(1);
  });

  it('refuses a lead that does not exist', async () => {
    await expect(deleteLead(prisma, accountId, 'nope')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
