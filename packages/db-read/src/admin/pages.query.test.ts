import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { FREE_CONVERSATIONS_PER_MONTH } from '@curios/core';
import { getAdminPage, listAdminPages } from './pages.query.js';

const write = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

const NOW = new Date('2026-10-21T02:00:00.000Z');
const DAY = 86_400_000;

const ids: Record<string, string> = {};

async function aPage(key: string, email: string, page: Record<string, unknown>): Promise<string> {
  const handle = `ap-${randomUUID().slice(0, 8)}`;
  const account = await write.account.create({
    data: { email, pages: { create: { handle, skeleton: handle, displayName: key, ...page } } },
    select: { pages: { select: { id: true } } },
  });
  ids[key] = account.pages[0]!.id;
  return ids[key];
}

beforeAll(async () => {
  await write.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
  await aPage('Live Biz', 'Owner.Live@Example.com', { mode: 'BUSINESS', published: true, paidUntil: new Date(NOW.getTime() + 20 * DAY), createdAt: new Date('2026-10-01T00:00:00Z') });
  await aPage('Draft Personal', 'draft@example.com', { mode: 'PERSONAL', published: false, createdAt: new Date('2026-10-02T00:00:00Z') });
  await aPage('Lapsed Biz', 'lapsed@example.com', { mode: 'BUSINESS', published: true, paidUntil: new Date(NOW.getTime() - DAY), leadsCaptured: 3, createdAt: new Date('2026-10-03T00:00:00Z') });
  await aPage('Bad Biz', 'bad@example.com', {
    mode: 'BUSINESS',
    published: true,
    suspendedAt: new Date('2026-10-10T00:00:00Z'),
    suspendReason: 'Spam',
    createdAt: new Date('2026-10-04T00:00:00Z'),
  });

  const live = ids['Live Biz']!;
  await write.payment.create({ data: { pageId: live, plan: 'MONTHLY', amountCents: 2900, provider: 'CHIP', status: 'PAID', paidAt: NOW, grantedUntil: new Date(NOW.getTime() + 20 * DAY) } });
  await write.payment.createMany({
    data: [1, 2].map(() => ({ pageId: live, plan: 'MONTHLY' as const, amountCents: 0, provider: 'GRANT' as const, status: 'PAID' as const, paidAt: NOW, grantedUntil: new Date(NOW.getTime() + 20 * DAY) })),
  });
  await write.usageCounter.create({ data: { pageId: live, period: '2026-10', count: 17 } });
  for (const [i, at] of ['2026-10-05', '2026-10-06', '2026-09-30'].entries()) {
    const conversation = await write.conversation.create({ data: { pageId: live } });
    await write.lead.create({ data: { pageId: live, conversationId: conversation.id, phone: `+6012345678${i}`, createdAt: new Date(`${at}T00:00:00Z`) } });
  }
  for (const [i, at] of ['2026-10-07', '2026-08-01'].entries()) {
    await write.order.create({
      data: {
        pageId: live, number: i + 1, code: `AB1${i}`, tokenHash: randomUUID(), customerName: 'X', phone: '+60112233445',
        method: 'PICKUP', day: new Date('2026-10-22'), itemsCents: 10, deliveryCents: 0, totalCents: 10, createdAt: new Date(`${at}T00:00:00Z`),
      },
    });
  }
  await write.fact.createMany({
    data: ['a', 'b'].map((c) => ({ pageId: live, category: 'MISC' as const, claim: c, normalizedClaim: c, confidence: 1 })),
  });
  await write.authIdentity.create({ data: { accountId: (await write.page.findUniqueOrThrow({ where: { id: live } })).accountId, provider: 'GOOGLE', providerUserId: randomUUID(), email: 'g@example.com' } });
  await write.passwordCredential.create({ data: { accountId: (await write.page.findUniqueOrThrow({ where: { id: live } })).accountId, hash: 'x' } });
});

afterAll(async () => {
  await write.$disconnect();
});

describe('listAdminPages', () => {
  it('lists newest first with a status per page', async () => {
    const rows = await listAdminPages({ filter: 'all', now: NOW });
    expect(rows.map((r) => [r.displayName, r.status])).toEqual([
      ['Bad Biz', 'Suspended'],
      ['Lapsed Biz', 'Lapsed'],
      ['Draft Personal', 'Draft'],
      ['Live Biz', 'Live'],
    ]);
    expect(rows[3]).toMatchObject({ ownerEmail: 'Owner.Live@Example.com', mode: 'BUSINESS' });
  });

  it('carries plan, paid until, the month’s conversations, cap, leads and orders', async () => {
    const rows = await listAdminPages({ now: NOW });
    const by = Object.fromEntries(rows.map((r) => [r.displayName, r]));
    expect(by['Live Biz']).toMatchObject({
      plan: 'Business',
      paidUntil: new Date(NOW.getTime() + 20 * DAY),
      conversationsThisMonth: 17,
      cap: FREE_CONVERSATIONS_PER_MONTH,
      leadsThisMonth: 2,
      ordersThisMonth: 1,
    });
    expect(by['Draft Personal']).toMatchObject({ plan: 'Personal', paidUntil: null, conversationsThisMonth: 0, leadsThisMonth: 0, ordersThisMonth: 0 });
    expect(by['Lapsed Biz']?.plan).toBe('Lapsed');
  });

  it('finds by owner email, case-insensitively', async () => {
    const rows = await listAdminPages({ q: 'OWNER.live@', now: NOW });
    expect(rows.map((r) => r.displayName)).toEqual(['Live Biz']);
  });

  it('finds by handle and by display name', async () => {
    const [draft] = await listAdminPages({ q: 'draft personal', now: NOW });
    expect(draft?.displayName).toBe('Draft Personal');
    const byHandle = await listAdminPages({ q: draft!.handle.toUpperCase(), now: NOW });
    expect(byHandle.map((r) => r.id)).toEqual([draft!.id]);
  });

  it('flagged lists only suspended pages', async () => {
    const rows = await listAdminPages({ filter: 'flagged', now: NOW });
    expect(rows.map((r) => r.displayName)).toEqual(['Bad Biz']);
  });

  it('lapsed lists only business pages whose plan ended, not suspended ones', async () => {
    const rows = await listAdminPages({ filter: 'lapsed', now: NOW });
    expect(rows.map((r) => r.displayName)).toEqual(['Lapsed Biz']);
  });

  it('business and personal split by mode', async () => {
    expect((await listAdminPages({ filter: 'personal', now: NOW })).map((r) => r.displayName)).toEqual(['Draft Personal']);
    expect(await listAdminPages({ filter: 'business', now: NOW })).toHaveLength(3);
  });

  it('honours limit', async () => {
    expect(await listAdminPages({ limit: 2, now: NOW })).toHaveLength(2);
  });
});

describe('getAdminPage', () => {
  it('returns the detail of a paid business page', async () => {
    const page = await getAdminPage(ids['Live Biz']!, NOW);
    expect(page).toMatchObject({
      displayName: 'Live Biz',
      status: 'Live',
      plan: 'Business',
      conversationsThisMonth: 17,
      cap: FREE_CONVERSATIONS_PER_MONTH,
      factCount: 2,
      grantedMonths: 2,
      leadsThisMonth: 2,
      ordersThisMonth: 1,
      suspendedAt: null,
      suspendReason: null,
    });
    expect(page?.signInMethods.sort()).toEqual(['google', 'password']);
    expect(page?.paidUntil).toEqual(new Date(NOW.getTime() + 20 * DAY));
  });

  it('carries the suspension and a Lapsed plan', async () => {
    expect(await getAdminPage(ids['Bad Biz']!, NOW)).toMatchObject({ status: 'Suspended', suspendReason: 'Spam', plan: 'Business trial' });
    expect(await getAdminPage(ids['Lapsed Biz']!, NOW)).toMatchObject({ plan: 'Lapsed' });
    expect(await getAdminPage(ids['Draft Personal']!, NOW)).toMatchObject({ plan: 'Personal', conversationsThisMonth: 0, signInMethods: [] });
  });

  it('is null for an unknown id', async () => {
    expect(await getAdminPage('nope', NOW)).toBeNull();
  });
});
