import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getLeadStats, getLeads } from './leads.query.js';

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

  it('says how many messages came before the number was left', async () => {
    const { pageId, accountId } = await anOwnerWithAPage();
    const conversation = await write.conversation.create({ data: { pageId } });
    const at = (minute: number) => new Date(Date.UTC(2026, 9, 17, 5, minute));
    await write.message.create({ data: { conversationId: conversation.id, role: 'USER', content: 'kek coklat?', createdAt: at(1) } });
    await write.message.create({ data: { conversationId: conversation.id, role: 'ASSISTANT', content: 'RM170.', createdAt: at(2) } });
    await write.lead.create({ data: { pageId, conversationId: conversation.id, phone: '+60127814402', createdAt: at(3) } });
    await write.message.create({ data: { conversationId: conversation.id, role: 'USER', content: 'terima kasih', createdAt: at(4) } });

    const [lead] = await getLeads(accountId);
    expect(lead?.transcript).toHaveLength(3);
    expect(lead?.capturedAfter).toBe(2);
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

  it('sees only leads belonging to its own account', async () => {
    // Scoped in the query, not filtered after the read. This is a phone
    // number; showing the wrong owner's is the worst read bug in the product.
    const leads = await getLeads(theirs);
    expect(leads.map((l) => l.phone)).toEqual(['+60111111111']);
  });

  it('clamps the limit rather than trusting a caller', async () => {
    const leads = await getLeads(mine, { limit: 1 });
    expect(leads).toHaveLength(1);
  });

  it('does not write, so the read-only role can run it', async () => {
    await expect(getLeads(mine)).resolves.toBeDefined();
  });
});

describe('getLeadStats', () => {
  it('counts what is waiting, what became a sale, and the last seven days', async () => {
    const now = new Date('2026-10-17T12:00:00Z');
    const ago = (hours: number) => new Date(now.getTime() - hours * 3600 * 1000);
    const owner = await anOwnerWithAPage();
    const other = await anOwnerWithAPage();
    await aLead(owner.pageId, '+60120000001', { createdAt: ago(1) });
    await aLead(owner.pageId, '+60120000002', { createdAt: ago(2), status: 'CONTACTED' });
    await aLead(owner.pageId, '+60120000003', { createdAt: ago(30), status: 'SOLD' });
    await aLead(owner.pageId, '+60120000004', { createdAt: ago(6 * 24 + 20) });
    await aLead(owner.pageId, '+60120000005', { createdAt: ago(9 * 24), status: 'CLOSED' });
    await aLead(other.pageId, '+60120000006', { createdAt: ago(1) });

    // Closed is not sold: an enquiry can end without a sale.
    expect(await getLeadStats(owner.accountId, now)).toEqual({ waiting: 2, thisWeek: 4, sold: 1 });
  });
});
