import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getOverview } from './overview.query.js';

const write = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

// Wednesday 2026-10-21, 10:00 in Malaysia. Malaysia midnight today is 2026-10-20T16:00Z.
const NOW = new Date('2026-10-21T02:00:00.000Z');
const MIDNIGHT = new Date('2026-10-20T16:00:00.000Z');
const DAY = 86_400_000;
const NEXT_MONTH = new Date(NOW.getTime() + 25 * DAY);

const ids: Record<string, string> = {};

async function aPage(key: string, page: Record<string, unknown> = {}): Promise<string> {
  const handle = `ov-${randomUUID().slice(0, 8)}`;
  const account = await write.account.create({
    data: { email: `${handle}@example.com`, pages: { create: { handle, skeleton: handle, displayName: key, mode: 'BUSINESS', ...page } } },
    select: { pages: { select: { id: true } } },
  });
  ids[key] = account.pages[0]!.id;
  return ids[key];
}

const pay = (pageId: string, data: Record<string, unknown>) =>
  write.payment.create({ data: { pageId, plan: 'MONTHLY', amountCents: 2900, status: 'PAID', ...data } as never });

beforeAll(async () => {
  await write.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
  await write.$executeRawUnsafe('TRUNCATE "ModelCall"');

  // Paid by CHIP, through next month; began paying today.
  await aPage('Chip', { published: true, paidUntil: NEXT_MONTH, createdAt: new Date(NOW.getTime() - 40 * DAY) });
  await pay(ids.Chip!, { provider: 'CHIP', paidAt: new Date(MIDNIGHT.getTime() + 3_600_000), grantedUntil: NEXT_MONTH });
  // Given a month: not revenue, not paying.
  await aPage('Gifted', { published: true, paidUntil: NEXT_MONTH, createdAt: new Date(NOW.getTime() - 40 * DAY) });
  await pay(ids.Gifted!, { provider: 'GRANT', amountCents: 0, paidAt: NOW, grantedUntil: NEXT_MONTH });
  // Paid long ago, now lapsed.
  await aPage('Old', { published: true, paidUntil: new Date(NOW.getTime() - 5 * DAY), createdAt: new Date(NOW.getTime() - 90 * DAY) });
  await pay(ids.Old!, { provider: 'CHIP', paidAt: new Date(NOW.getTime() - 35 * DAY), grantedUntil: new Date(NOW.getTime() - 5 * DAY) });
  // Plan ends in 3 days (paid), and another in 3 days by grant.
  const soon = new Date(NOW.getTime() + 3 * DAY);
  await aPage('Ending', { published: true, paidUntil: soon, createdAt: new Date(NOW.getTime() - 40 * DAY) });
  await pay(ids.Ending!, { provider: 'CHIP', paidAt: new Date(NOW.getTime() - 27 * DAY), grantedUntil: soon });
  await aPage('EndingGrant', { published: true, paidUntil: soon, createdAt: new Date(NOW.getTime() - 40 * DAY) });
  await pay(ids.EndingGrant!, { provider: 'GRANT', amountCents: 0, paidAt: NOW, grantedUntil: soon });
  // Personal, unpublished, suspended.
  await aPage('Solo', { mode: 'PERSONAL', published: false, createdAt: new Date(NOW.getTime() - 40 * DAY) });
  await aPage('Held', { published: true, suspendedAt: NOW, createdAt: new Date(NOW.getTime() - 40 * DAY) });
  // Newest page, made today.
  await aPage('Fresh', { mode: 'PERSONAL', published: true, createdAt: new Date(MIDNIGHT.getTime() + 60_000) });

  const convo = async (pageId: string, createdAt: Date) => (await write.conversation.create({ data: { pageId, createdAt }, select: { id: true } })).id;
  // Today (Malaysia): 16:00:00Z sharp is in, one second before is yesterday.
  const inToday = await convo(ids.Chip!, MIDNIGHT);
  await convo(ids.Chip!, new Date(NOW.getTime() - 3_600_000));
  const yesterday = await convo(ids.Chip!, new Date(MIDNIGHT.getTime() - 1000));
  await convo(ids.Gifted!, new Date(NOW.getTime() - 3 * DAY));
  await convo(ids.Gifted!, new Date(NOW.getTime() - 20 * DAY));

  const topic = await write.topic.create({ data: { pageId: ids.Chip!, title: 'Hours' } });
  const q = await write.question.create({ data: { pageId: ids.Chip!, text: 'open?', normalizedQuestion: 'open', topicId: topic.id } });
  await write.questionAsk.createMany({
    data: [
      { questionId: q.id, askedAt: NOW, answered: true },
      { questionId: q.id, askedAt: NOW, answered: false },
      { questionId: q.id, askedAt: NOW, answered: null },
    ],
  });

  const call = (conversationId: string, costMilliCents: number, createdAt: Date) => ({
    conversationId, model: 'claude-haiku-4-5', inputTokens: 1, outputTokens: 1, costMilliCents, priceVersion: 'v', latencyMs: 1, ok: true, createdAt,
  });
  await write.modelCall.createMany({ data: [call(inToday, 300, NOW), call(yesterday, 1000, new Date(MIDNIGHT.getTime() - 1000))] });

  await write.ingestion.create({ data: { pageId: ids.Chip!, status: 'FAILED', error: 'x', pastedText: 'p', updatedAt: new Date(NOW.getTime() - DAY) } });
  await write.ingestion.create({ data: { pageId: ids.Chip!, status: 'SUCCEEDED', pastedText: 'p' } });
  await write.fact.createMany({ data: ['a', 'b', 'c'].map((c) => ({ pageId: ids.Fresh!, category: 'MISC' as const, claim: c, normalizedClaim: c, confidence: 1 })) });
  await write.fact.create({ data: { pageId: ids.Fresh!, category: 'MISC', claim: 'x', normalizedClaim: 'x', confidence: 1, rejectedAt: NOW } });
  await write.usageCounter.createMany({
    data: [
      { pageId: ids.Chip!, period: '2026-10', count: 200 },
      { pageId: ids.Gifted!, period: '2026-10', count: 199 },
    ],
  });
});

afterAll(async () => {
  await write.$disconnect();
});

describe('getOverview', () => {
  it('counts a GRANT as neither revenue nor paying; CHIP through next month is paying', async () => {
    const o = await getOverview('30d', NOW);
    expect(o.paying).toEqual({ count: 2, newInPeriod: 2 }); // Chip, Ending (both first paid within 30 days) -- not Gifted, EndingGrant, Old
    expect(o.revenueCents).toBe(2900 + 2900); // Chip and Ending; Old paid 35 days ago, grants are free
    const today = await getOverview('today', NOW);
    expect(today.revenueCents).toBe(2900);
    expect(today.paying.newInPeriod).toBe(1);
  });

  it('starts today at Malaysia midnight', async () => {
    const o = await getOverview('today', NOW);
    expect(o.conversations).toEqual({ count: 2, previous: 1 });
    expect(o.aiCost).toEqual({ milliCents: 300, perConversationMilliCents: 150 });
  });

  it('7d and 30d windows', async () => {
    expect((await getOverview('7d', NOW)).conversations).toEqual({ count: 4, previous: 0 });
    expect((await getOverview('30d', NOW)).conversations).toEqual({ count: 5, previous: 0 });
    expect((await getOverview('30d', NOW)).aiCost.milliCents).toBe(1300);
  });

  it('counts answered asks against recorded ones', async () => {
    expect((await getOverview('today', NOW)).answered).toEqual({ answered: 1, recorded: 2 });
  });

  it('gives seven Malaysian days, oldest first', async () => {
    const o = await getOverview('today', NOW);
    expect(o.perDay.map((d) => d.day)).toEqual(['2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21']);
    // 16:00Z on the 20th is already the 21st in Malaysia; one second before is the 20th.
    expect(o.perDay.at(-1)!.count).toBe(2);
    expect(o.perDay.at(-2)!.count).toBe(1);
    expect(o.perDay.find((d) => d.day === '2026-10-18')!.count).toBe(1);
  });

  it('flags what needs attention', async () => {
    const o = await getOverview('7d', NOW);
    expect(o.needsYou.failedReads).toBe(1);
    expect(o.needsYou.atCap.count).toBe(1);
    expect(o.needsYou.atCap.names).toEqual(['Chip']);
    expect(o.needsYou.plansEnding).toBe(1); // Ending, not EndingGrant
  });

  it('counts live pages and kinds', async () => {
    const o = await getOverview('today', NOW);
    // published and not suspended: Chip, Gifted, Old, Ending, EndingGrant, Fresh
    expect(o.livePages).toEqual({ count: 6, newInPeriod: 1 });
    // Solo (draft) and Held (suspended) are not counted; Fresh is the one live personal page.
    expect(o.byKind).toEqual({ personal: 1, business: 5 });
  });

  it('lists the five newest pages', async () => {
    const o = await getOverview('today', NOW);
    expect(o.newPages).toHaveLength(5);
    expect(o.newPages[0]).toMatchObject({ name: 'Fresh', mode: 'PERSONAL', factCount: 3, hasConversation: false });
    const chip = (await getOverview('today', NOW)).newPages.find((p) => p.name === 'Chip');
    // Chip is 40 days old, older than the five newest, so it is not listed.
    expect(chip).toBeUndefined();
  });
});
