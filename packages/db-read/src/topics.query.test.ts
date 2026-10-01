import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getTopics } from './topics.query.js';

const write = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

let ownerA = '';
let ownerB = '';
let ownerBig = '';

async function anOwnerWithAPage() {
  const slug = randomUUID().slice(0, 8);
  const account = await write.account.create({
    data: { email: `tq-${randomUUID()}@example.com`, pages: { create: { handle: `tq-${slug}`, skeleton: `tq-${slug}`, displayName: 'T' } } },
    select: { id: true, pages: { select: { id: true } } },
  });
  return { accountId: account.id, pageId: account.pages[0]?.id ?? '' };
}

async function topic(
  pageId: string,
  title: string,
  askCount: number,
  lastAskedAt: string,
  extra: Record<string, unknown> = {},
) {
  return write.topic.create({ data: { pageId, title, askCount, lastAskedAt: new Date(lastAskedAt), ...extra } });
}

async function wording(pageId: string, topicId: string, text: string, askCount: number, firstAskedAt: string) {
  return write.question.create({
    data: { pageId, topicId, text, normalizedQuestion: text.toLowerCase(), askCount, firstAskedAt: new Date(firstAskedAt) },
  });
}

beforeAll(async () => {
  const a = await anOwnerWithAPage();
  const b = await anOwnerWithAPage();
  const big = await anOwnerWithAPage();
  ownerA = a.accountId;
  ownerB = b.accountId;
  ownerBig = big.accountId;

  // Created least-asked first so insertion order differs from the expected order.
  const unanswered = await topic(a.pageId, 'Ada delivery?', 2, '2026-03-01T00:00:00Z');
  await wording(a.pageId, unanswered.id, 'Ada delivery?', 2, '2026-03-01T00:00:00Z');

  const conflict = await topic(a.pageId, 'Boleh tempah?', 1, '2026-03-02T00:00:00Z', {
    answer: 'Boleh, 2 hari awal.',
    conflictAnswer: 'Boleh, 3 hari awal.',
  });
  await wording(a.pageId, conflict.id, 'Boleh tempah?', 1, '2026-03-02T00:00:00Z');

  // The title's wording has the LOWER count: wordings sort by count, not by being the title.
  const answered = await topic(a.pageId, 'Berapa harga kek?', 4, '2026-03-03T00:00:00Z', {
    answer: 'RM95.',
    faqSlug: 'berapa-harga-kek',
    faqSuppressed: true,
  });
  await wording(a.pageId, answered.id, 'Berapa harga kek?', 1, '2026-03-01T00:00:00Z');
  await wording(a.pageId, answered.id, 'Harga kek berapa', 3, '2026-03-02T00:00:00Z');

  // Tie on askCount with `conflict`: the more recently asked comes first.
  const tied = await topic(a.pageId, 'Ada halal?', 1, '2026-03-05T00:00:00Z');
  await wording(a.pageId, tied.id, 'Ada halal?', 1, '2026-03-05T00:00:00Z');

  const theirs = await topic(b.pageId, 'Someone elses topic', 99, '2026-03-04T00:00:00Z');
  await wording(b.pageId, theirs.id, 'Someone elses topic', 99, '2026-03-04T00:00:00Z');

  await write.topic.createMany({
    data: Array.from({ length: 101 }, (_, i) => ({ pageId: big.pageId, title: `Topic ${i}`, askCount: 1, lastAskedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)) })),
  });
});

afterAll(async () => {
  await write.$disconnect();
});

describe('getTopics', () => {
  it('orders by askCount, then most recently asked', async () => {
    const topics = await getTopics(ownerA);
    expect(topics.map((t) => t.title)).toEqual(['Berapa harga kek?', 'Ada delivery?', 'Ada halal?', 'Boleh tempah?']);
  });

  it('lists a topic wordings most asked first, including the title wording', async () => {
    const topics = await getTopics(ownerA);
    const answered = topics.find((t) => t.title === 'Berapa harga kek?');
    expect(answered?.wordings.map((w) => [w.text, w.askCount])).toEqual([
      ['Harga kek berapa', 3],
      ['Berapa harga kek?', 1],
    ]);
    expect(answered?.wordings[0]).toEqual({ id: expect.any(String), text: 'Harga kek berapa', askCount: 3 });
  });

  it('carries the answer, the FAQ state, and the conflict', async () => {
    const topics = await getTopics(ownerA);
    const answered = topics.find((t) => t.title === 'Berapa harga kek?');
    expect(answered).toMatchObject({ answer: 'RM95.', conflictAnswer: null, faqSlug: 'berapa-harga-kek', faqSuppressed: true, askCount: 4 });
    expect(answered?.lastAskedAt).toEqual(new Date('2026-03-03T00:00:00Z'));
    const conflict = topics.find((t) => t.title === 'Boleh tempah?');
    expect(conflict).toMatchObject({ answer: 'Boleh, 2 hari awal.', conflictAnswer: 'Boleh, 3 hari awal.', faqSlug: null, faqSuppressed: false });
    const unanswered = topics.find((t) => t.title === 'Ada delivery?');
    expect(unanswered).toMatchObject({ answer: null, conflictAnswer: null });
  });

  it("never returns another owner's topics", async () => {
    expect(JSON.stringify(await getTopics(ownerA))).not.toContain('Someone elses');
    expect((await getTopics(ownerB)).map((t) => t.title)).toEqual(['Someone elses topic']);
  });

  it('returns nothing for an account with no page', async () => {
    const account = await write.account.create({ data: { email: `tq-np-${randomUUID()}@example.com` } });
    expect(await getTopics(account.id)).toEqual([]);
  });

  it('honours a small limit, floors a non-positive one at 1, and caps at 100', async () => {
    expect(await getTopics(ownerA, { limit: 2 })).toHaveLength(2);
    expect(await getTopics(ownerA, { limit: 0 })).toHaveLength(1);
    expect(await getTopics(ownerBig, { limit: 500 })).toHaveLength(100);
  });

  it('defaults to 50', async () => {
    expect(await getTopics(ownerBig)).toHaveLength(50);
  });
});
