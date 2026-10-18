import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { retentionCutoff, runRetention } from './retention.js';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });
const now = new Date('2027-10-18T03:00:00Z');
const old = new Date('2026-10-17T03:00:00Z');
const recent = new Date('2026-10-19T03:00:00Z');

let accountId = '';
let pageId = '';

beforeAll(async () => {
  const account = await prisma.account.create({
    data: {
      email: `ret-${randomUUID()}@example.com`,
      pages: { create: { handle: `r${randomUUID().slice(0, 8)}`, skeleton: `r${randomUUID().slice(0, 8)}`, displayName: 'Retention' } },
    },
    include: { pages: true },
  });
  accountId = account.id;
  pageId = account.pages[0]!.id;
});

afterAll(async () => {
  await prisma.account.delete({ where: { id: accountId } });
  await prisma.$disconnect();
});

/** A conversation from `at`, with one message and, if asked, a lead. */
async function aConversation(at: Date, lead: boolean) {
  const conversation = await prisma.conversation.create({
    data: {
      pageId,
      createdAt: at,
      messages: { create: { role: 'USER', content: 'boleh hantar ke klang?', createdAt: at } },
      ...(lead ? { lead: { create: { pageId, phone: '+60127814402', createdAt: at } } } : {}),
    },
  });
  return conversation.id;
}

describe('retentionCutoff', () => {
  it('is twelve months before now', () => {
    expect(retentionCutoff(now).toISOString()).toBe('2026-10-18T03:00:00.000Z');
  });
});

describe('runRetention', () => {
  it('deletes leads and messages past twelve months, with their emptied conversations, and keeps the rest', async () => {
    const gone = await aConversation(old, true);
    const kept = await aConversation(recent, true);

    await runRetention({ prisma, now });

    expect(await prisma.conversation.findUnique({ where: { id: gone } })).toBeNull();
    expect(await prisma.lead.count({ where: { conversationId: gone } })).toBe(0);
    expect(await prisma.message.count({ where: { conversationId: gone } })).toBe(0);

    expect(await prisma.lead.count({ where: { conversationId: kept } })).toBe(1);
    expect(await prisma.message.count({ where: { conversationId: kept } })).toBe(1);
  });

  it('keeps an old conversation that still has recent messages, dropping only the old ones', async () => {
    const id = await aConversation(old, false);
    await prisma.message.create({ data: { conversationId: id, role: 'ASSISTANT', content: 'Ya, RM10.', createdAt: recent } });

    await runRetention({ prisma, now });

    expect(await prisma.conversation.findUnique({ where: { id } })).not.toBeNull();
    expect(await prisma.message.findMany({ where: { conversationId: id }, select: { content: true } })).toEqual([{ content: 'Ya, RM10.' }]);
  });
});
