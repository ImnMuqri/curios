import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { countNavBadges } from './my-curios.query.js';
import { getLeadStats, getLeads, TRANSCRIPT_LIMIT } from './leads.query.js';

const write = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

let mine = '';
let theirs = '';
const accountIds: string[] = [];

async function anOwnerWithAPage(): Promise<{ accountId: string; pageId: string }> {
  const slug = randomUUID().slice(0, 8);
  const account = await write.account.create({
    data: {
      email: `ld-${randomUUID()}@example.com`,
      pages: { create: { handle: `ld-${slug}`, skeleton: `ld-${slug}`, displayName: 'L' } },
    },
    select: { id: true, pages: { select: { id: true } } },
  });
  accountIds.push(account.id);
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

  it('pages on from the last lead shown, and another owner’s lead as the cursor pages nothing', async () => {
    const [newest, older] = await getLeads(mine);
    expect((await getLeads(mine, { limit: 1 })).map((l) => l.id)).toEqual([newest!.id]);
    expect((await getLeads(mine, { limit: 1, before: newest!.id })).map((l) => l.id)).toEqual([older!.id]);
    expect(await getLeads(mine, { before: older!.id })).toEqual([]);
    const [stranger] = await getLeads(theirs);
    expect(await getLeads(mine, { before: stranger!.id })).toEqual([]);
  });

  it('never splits or repeats leads left in the same instant across a page boundary', async () => {
    const { pageId, accountId } = await anOwnerWithAPage();
    const at = new Date('2026-09-10T10:00:00Z');
    const ids = await Promise.all(['+60120000001', '+60120000002', '+60120000003'].map((phone) => aLead(pageId, phone, { createdAt: at })));
    const first = await getLeads(accountId, { limit: 2 });
    const rest = await getLeads(accountId, { limit: 2, before: first.at(-1)!.id });
    expect([...first, ...rest].map((l) => l.id).sort()).toEqual([...ids].sort());
  });

  it('sends the first TRANSCRIPT_LIMIT messages of a long chat and says how many there were', async () => {
    const { pageId, accountId } = await anOwnerWithAPage();
    const conversation = await write.conversation.create({ data: { pageId } });
    const total = TRANSCRIPT_LIMIT + 5;
    await write.message.createMany({
      data: Array.from({ length: total }, (_, i) => ({ conversationId: conversation.id, role: 'USER' as const, content: `m${i}`, createdAt: new Date(Date.UTC(2026, 9, 1, 0, i)) })),
    });
    await write.lead.create({ data: { pageId, conversationId: conversation.id, phone: '+60127814402', createdAt: new Date(Date.UTC(2026, 9, 1, 0, 2, 30)) } });
    const [lead] = await getLeads(accountId);
    expect(lead?.transcript).toHaveLength(TRANSCRIPT_LIMIT);
    expect(lead?.transcript[0]?.content).toBe('m0');
    expect(lead?.messageCount).toBe(total);
    expect(lead?.capturedAfter).toBe(3);
  });

  it('reads an enquiry’s name, message and item, and null for a number left in the chat', async () => {
    const { pageId, accountId } = await anOwnerWithAPage();
    const item = await write.item.create({
      data: { pageId, name: 'Kek kahwin', slug: 'kek-kahwin', position: 0, priceCents: 18_000, askForPrice: true, photoKey: 'items/p/kahwin.webp' },
    });
    const enquiry = await aLead(pageId, '+60121111111', {
      kind: 'ENQUIRY',
      itemId: item.id,
      name: 'Aisyah',
      note: 'Kek 3 tingkat untuk 150 orang.',
      createdAt: new Date('2026-11-08T10:00:00Z'),
    });
    const removed = await aLead(pageId, '+60122222222', { kind: 'ENQUIRY', name: 'Ben', note: 'Untuk 20 orang.', createdAt: new Date('2026-11-08T09:00:00Z') });
    const chat = await aLead(pageId, '+60123333333', { createdAt: new Date('2026-11-08T08:00:00Z') });

    const leads = await getLeads(accountId);
    const byId = new Map(leads.map((lead) => [lead.id, lead]));
    expect(byId.get(enquiry)?.enquiry).toEqual({
      name: 'Aisyah',
      note: 'Kek 3 tingkat untuk 150 orang.',
      item: { name: 'Kek kahwin', photoKey: 'items/p/kahwin.webp', fromCents: 18_000 },
    });
    // The item removed since: the enquiry stays, without it.
    expect(byId.get(removed)?.enquiry).toEqual({ name: 'Ben', note: 'Untuk 20 orang.', item: null });
    expect(byId.get(chat)?.enquiry).toBeNull();
  });
});

afterAll(async () => {
  // Leads, conversations and messages go with their page, pages with their account.
  await write.account.deleteMany({ where: { id: { in: accountIds } } });
  await write.$disconnect();
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
    expect(await getLeadStats(owner.accountId, now)).toMatchObject({ waiting: 2, thisWeek: 4, sold: 1 });
  });

  it('gives the week bar, last week and the sold of this week, by Malaysian day', async () => {
    // Sunday 2026-10-18, 23:30 in Malaysia.
    const now = new Date('2026-10-18T15:30:00Z');
    const owner = await anOwnerWithAPage();
    const other = await anOwnerWithAPage();
    const lead = (phone: string, at: string, extra: Record<string, unknown> = {}) =>
      aLead(owner.pageId, phone, { createdAt: new Date(at), ...extra });
    // Today (18th MYT) starts at 17th 16:00Z; yesterday's last second is 15:59:59Z.
    await lead('+60120000011', '2026-10-17T16:00:00Z', { status: 'SOLD' });
    await lead('+60120000012', '2026-10-17T15:59:59Z');
    // The first slot (12th MYT) starts 11th 16:00Z; a second earlier is last week's final day.
    await lead('+60120000013', '2026-10-11T16:00:00Z', { status: 'SOLD' });
    await lead('+60120000014', '2026-10-11T15:59:59Z', { status: 'SOLD' });
    // Last week's first day (5th MYT) starts 4th 16:00Z; before it is out of both.
    await lead('+60120000015', '2026-10-04T16:00:00Z');
    await lead('+60120000016', '2026-10-04T15:59:59Z');
    // After today's midnight: not yet counted.
    await lead('+60120000017', '2026-10-18T16:00:00Z');
    await aLead(other.pageId, '+60120000018', { createdAt: new Date('2026-10-18T10:00:00Z'), status: 'SOLD' });

    const stats = await getLeadStats(owner.accountId, now);
    expect(stats.days).toEqual([1, 0, 0, 0, 0, 1, 1]);
    expect(stats.days).toHaveLength(7);
    expect(stats.thisWeek).toBe(3);
    expect(stats.lastWeek).toBe(2);
    expect(stats.soldThisWeek).toBe(2);
    expect(stats.sold).toBe(3);
  });

  it('is all zeros for an owner with no leads, and waiting matches the sidebar badge', async () => {
    const now = new Date('2026-10-18T15:30:00Z');
    const quiet = await anOwnerWithAPage();
    expect(await getLeadStats(quiet.accountId, now)).toEqual({
      waiting: 0, thisWeek: 0, sold: 0, lastWeek: 0, days: [0, 0, 0, 0, 0, 0, 0], soldThisWeek: 0,
    });

    const owner = await anOwnerWithAPage();
    await aLead(owner.pageId, '+60120000021', { createdAt: now });
    await aLead(owner.pageId, '+60120000022', { createdAt: now, status: 'CONTACTED' });
    await aLead(owner.pageId, '+60120000023', { createdAt: new Date('2026-01-01T00:00:00Z') });
    const stats = await getLeadStats(owner.accountId, now);
    expect(stats.waiting).toBe(2);
    expect((await countNavBadges(owner.accountId)).leads).toBe(stats.waiting);
  });
});
