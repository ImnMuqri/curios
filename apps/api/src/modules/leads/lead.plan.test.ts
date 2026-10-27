import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { defaultSettings, FREE_LEADS } from '@curios/core';
import { captureLead, NotQualifiedError } from './lead.service.js';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });
const queue = { add: vi.fn() };

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
  queue.add.mockClear();
});

/**
 * A conversation that already qualifies for capture, so the only thing these
 * tests vary is the plan. Three visitor turns and a number, which is what
 * `qualifies` in packages/core requires.
 */
async function readyToCapture(page: { paidUntil?: Date | null; leadsCaptured?: number }) {
  const account = await prisma.account.create({
    data: { email: `pg-${randomUUID()}@example.com` },
    select: { id: true },
  });
  const slug = `pg-${randomUUID().slice(0, 8)}`;
  const row = await prisma.page.create({
    data: {
      accountId: account.id,
      handle: slug,
      skeleton: slug,
      displayName: 'Nadia Bakes',
      published: true,
      paidUntil: page.paidUntil ?? null,
      leadsCaptured: page.leadsCaptured ?? 0,
    },
    select: { id: true },
  });
  const conversation = await prisma.conversation.create({
    data: {
      pageId: row.id,
      messages: {
        create: [
          { role: 'USER', content: 'nak order kek 2kg' },
          { role: 'ASSISTANT', content: 'boleh' },
          { role: 'USER', content: 'untuk 20 orang' },
          { role: 'ASSISTANT', content: 'ok' },
          { role: 'USER', content: 'hantar 5 haribulan' },
        ],
      },
    },
    select: { id: true },
  });
  return { pageId: row.id, conversationId: conversation.id };
}

const capture = (conversationId: string) =>
  captureLead({ prisma, queue, settings: defaultSettings() }, { conversationId, phone: '0123456789' });

describe('the capture gate', () => {
  it('captures for a page inside its trial', async () => {
    const { conversationId } = await readyToCapture({ leadsCaptured: 0 });

    await expect(capture(conversationId)).resolves.toMatchObject({ leadId: expect.any(String) });
  });

  it('captures on the last free lead', async () => {
    const { conversationId } = await readyToCapture({ leadsCaptured: FREE_LEADS - 1 });

    await expect(capture(conversationId)).resolves.toBeTruthy();
  });

  it('refuses once the trial is spent and nothing has been paid', async () => {
    const { conversationId } = await readyToCapture({ leadsCaptured: FREE_LEADS });

    await expect(capture(conversationId)).rejects.toBeInstanceOf(NotQualifiedError);
  });

  it('refuses with the same error an unqualified conversation gets', async () => {
    // Deliberate. A distinguishable billing error would make this endpoint an
    // oracle for the owner's billing status, readable by anyone with curl.
    // It does not make that status secret -- the public page omits the card,
    // and one anonymous GET reads that -- but it keeps the API from being a
    // second and clearer channel than the page already is.
    const { conversationId } = await readyToCapture({ leadsCaptured: FREE_LEADS });

    await expect(capture(conversationId)).rejects.toMatchObject({ code: 'NOT_QUALIFIED' });
  });

  it('captures for a paid page whose trial is long gone', async () => {
    const { conversationId } = await readyToCapture({
      paidUntil: new Date(Date.now() + 86_400_000),
      leadsCaptured: 99,
    });

    await expect(capture(conversationId)).resolves.toBeTruthy();
  });

  it('refuses a page whose payment has lapsed', async () => {
    const { conversationId } = await readyToCapture({
      paidUntil: new Date(Date.now() - 86_400_000),
      leadsCaptured: FREE_LEADS,
    });

    await expect(capture(conversationId)).rejects.toBeInstanceOf(NotQualifiedError);
  });

  it('counts a captured lead against the trial', async () => {
    const { pageId, conversationId } = await readyToCapture({ leadsCaptured: 1 });

    await capture(conversationId);

    const row = await prisma.page.findUniqueOrThrow({
      where: { id: pageId },
      select: { leadsCaptured: true },
    });
    expect(row.leadsCaptured).toBe(2);
  });

  it('does not count a refused capture', async () => {
    // The counter must track leads that exist. A refusal that still
    // incremented would spend a page's trial without giving it anything.
    const { pageId, conversationId } = await readyToCapture({ leadsCaptured: FREE_LEADS });

    await expect(capture(conversationId)).rejects.toBeInstanceOf(NotQualifiedError);

    const row = await prisma.page.findUniqueOrThrow({
      where: { id: pageId },
      select: { leadsCaptured: true },
    });
    expect(row.leadsCaptured).toBe(FREE_LEADS);
  });

  it('stores the lead and the count together or not at all', async () => {
    // One transaction. Two statements that can partially fail would either
    // lose a count -- a free fourth lead -- or count a lead nobody stored.
    const { pageId, conversationId } = await readyToCapture({ leadsCaptured: 0 });

    await capture(conversationId);

    const [leads, row] = await Promise.all([
      prisma.lead.count({ where: { pageId } }),
      prisma.page.findUniqueOrThrow({ where: { id: pageId }, select: { leadsCaptured: true } }),
    ]);
    expect(leads).toBe(1);
    expect(row.leadsCaptured).toBe(1);
  });
});
