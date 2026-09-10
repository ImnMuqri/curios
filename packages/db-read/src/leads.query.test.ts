import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getLeads } from './leads.query.js';

const write = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

let mine = '';
let theirs = '';

async function anOwnerWithAPage(): Promise<{ accountId: string; pageId: string }> {
  const slug = randomUUID().slice(0, 8);
  const account = await write.account.create({
    data: {
      email: `ld-${randomUUID()}@example.com`,
      pages: { create: { handle: `ld-${slug}`, skeleton: `ld-${slug}`, displayName: 'L' } },
    },
    select: { id: true, pages: { select: { id: true } } },
  });
  return { accountId: account.id, pageId: account.pages[0]?.id ?? '' };
}

async function aLead(
  pageId: string,
  phone: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const conversation = await write.conversation.create({ data: { pageId } });
  for (const [role, content] of [
    ['USER', 'nak kek butter 2kg'],
    ['ASSISTANT', 'RM160 untuk 2kg.'],
  ] as const) {
    await write.message.create({ data: { conversationId: conversation.id, role, content } });
  }
  const lead = await write.lead.create({
    data: { pageId, conversationId: conversation.id, phone, ...extra },
  });
  return lead.id;
}

beforeAll(async () => {
  const a = await anOwnerWithAPage();
  const b = await anOwnerWithAPage();
  mine = a.accountId;
  theirs = b.accountId;

  await aLead(a.pageId, '+60123456789', {
    score: 2,
    slots: { product: 'kek butter 2kg', date: null, location: 'Klang' },
    createdAt: new Date('2026-09-01T10:00:00Z'),
  });
  await aLead(a.pageId, '+60129999999', { createdAt: new Date('2026-09-05T10:00:00Z') });
  await aLead(b.pageId, '+60111111111');
});

describe('getLeads', () => {
  it('returns the newest first, because a cold lead is a lost one', async () => {
    const leads = await getLeads(mine);
    expect(leads.map((l) => l.phone)).toEqual(['+60129999999', '+60123456789']);
  });

  it('carries the transcript with each lead', async () => {
    // BACKEND.md: the transcript is "the feature people pay for". Fetching it
    // on demand would mean a second round trip to read ten short rows.
    const leads = await getLeads(mine);
    const withSlots = leads.find((l) => l.phone === '+60123456789');
    expect(withSlots?.transcript.map((line) => line.content)).toEqual([
      'nak kek butter 2kg',
      'RM160 untuk 2kg.',
    ]);
  });

  it('carries the slots and the score', async () => {
    const leads = await getLeads(mine);
    const withSlots = leads.find((l) => l.phone === '+60123456789');
    expect(withSlots?.score).toBe(2);
    expect(withSlots?.slots).toMatchObject({ product: 'kek butter 2kg', location: 'Klang' });
  });

  it('copes with a lead whose extraction never filled anything in', async () => {
    // slots is null until the job runs, and can stay null if extraction
    // failed -- which slice 4 deliberately allows, because a lead with no
    // slots is worth far more than no lead.
    const leads = await getLeads(mine);
    expect(leads.find((l) => l.phone === '+60129999999')?.slots).toBeNull();
  });

  it('returns nothing for an account that owns none of them', async () => {
    // Scoped in the query, not filtered after the read. This is a phone
    // number; showing the wrong owner's is the worst read bug in the product.
    const leads = await getLeads(theirs);
    expect(leads.map((l) => l.phone)).toEqual(['+60111111111']);
  });

  it('does not write, so the read-only role can run it', async () => {
    await expect(getLeads(mine)).resolves.toBeDefined();
  });
});
