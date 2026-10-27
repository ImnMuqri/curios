import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { countQuestionsThisWeek, countTopicsNeedingOwner, getAnswerRate, getTopicChoices, getTopics, getTopicTotals } from './topics.query.js';

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
  it('pages through topics that tie on asks and time, each exactly once', async () => {
    const { accountId, pageId } = await anOwnerWithAPage();
    const at = '2026-10-20T00:00:00Z';
    const ids = (await Promise.all(['a', 'b', 'c', 'd', 'e'].map((t) => topic(pageId, t, 2, at)))).map((t) => t.id);
    const pages = await Promise.all([0, 2, 4].map((offset) => getTopics(accountId, { limit: 2, offset })));
    expect(pages.map((p) => p.length)).toEqual([2, 2, 1]);
    expect(pages.flat().map((t) => t.id).sort()).toEqual([...ids].sort());
  });

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

describe('the week of asks', () => {
  const now = new Date('2026-10-17T12:00:00Z');
  const ago = (hours: number) => new Date(now.getTime() - hours * 3600 * 1000);

  it('counts each topic’s asks in each of the last seven days, oldest first, today last', async () => {
    const { accountId, pageId } = await anOwnerWithAPage();
    const t = await topic(pageId, 'Ada delivery?', 5, '2026-10-17T11:00:00Z');
    const one = await wording(pageId, t.id, 'Ada delivery?', 3, '2026-10-10T00:00:00Z');
    const two = await wording(pageId, t.id, 'delivery ada', 2, '2026-10-10T00:00:00Z');
    const quiet = await topic(pageId, 'Ada halal?', 1, '2026-10-01T00:00:00Z');
    const old = await wording(pageId, quiet.id, 'Ada halal?', 1, '2026-10-01T00:00:00Z');
    await write.questionAsk.createMany({
      data: [
        { questionId: one.id, askedAt: ago(1) },
        { questionId: two.id, askedAt: ago(2) },
        { questionId: one.id, askedAt: ago(25) },
        { questionId: two.id, askedAt: ago(6 * 24 + 23) },
        // Older than a week, and after now: neither counts.
        { questionId: one.id, askedAt: ago(8 * 24) },
        { questionId: one.id, askedAt: new Date(now.getTime() + 3600 * 1000) },
        { questionId: old.id, askedAt: ago(10 * 24) },
      ],
    });

    const topics = await getTopics(accountId, { now });
    expect(topics.find((x) => x.id === t.id)?.week).toEqual([1, 0, 0, 0, 0, 1, 2]);
    expect(topics.find((x) => x.id === quiet.id)?.week).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it('counts every visitor turn on the page this week, and nobody else’s', async () => {
    const mine = await anOwnerWithAPage();
    const theirs = await anOwnerWithAPage();
    const say = async (pageId: string, turns: { role: 'USER' | 'ASSISTANT'; createdAt: Date }[]) =>
      write.conversation.create({ data: { pageId, messages: { create: turns.map((turn) => ({ ...turn, content: 'x' })) } } });
    await say(mine.pageId, [
      { role: 'USER', createdAt: ago(1) },
      { role: 'ASSISTANT', createdAt: ago(1) },
      { role: 'USER', createdAt: ago(48) },
      { role: 'USER', createdAt: ago(8 * 24) },
    ]);
    await say(theirs.pageId, [{ role: 'USER', createdAt: ago(1) }]);

    expect(await countQuestionsThisWeek(mine.accountId, now)).toBe(2);
  });
});

describe('getAnswerRate', () => {
  it('counts the last thirty days of asks whose outcome was recorded, and how many the chat could answer', async () => {
    const now = new Date('2026-10-18T12:00:00Z');
    const day = (n: number) => new Date(now.getTime() - n * 24 * 3600 * 1000);
    const { accountId, pageId } = await anOwnerWithAPage();
    const t = await topic(pageId, 'Delivery?', 5, '2026-10-17T00:00:00Z');
    const q = await wording(pageId, t.id, `delivery ${randomUUID().slice(0, 6)}`, 5, '2026-10-01T00:00:00Z');
    for (const [ago, answered] of [[1, true], [2, true], [3, false], [5, null], [40, true]] as const) {
      await write.questionAsk.create({ data: { questionId: q.id, askedAt: day(ago), answered } });
    }

    // Two answered of three recorded; the unrecorded one and the old one are left out.
    expect(await getAnswerRate(accountId, now)).toEqual({ answered: 2, recorded: 3 });
  });
});

describe('a filtered list, and figures over every topic', () => {
  let owner = '';
  let other = '';
  const at = (day: number) => new Date(Date.UTC(2026, 9, day));
  beforeAll(async () => {
    const page = await anOwnerWithAPage();
    owner = page.accountId;
    const asks = async (topicId: string, text: string, list: { day: number; answered: boolean | null; reply: string | null }[]) => {
      const q = await wording(page.pageId, topicId, text, list.length, '2026-10-01T00:00:00Z');
      await write.questionAsk.createMany({ data: list.map(({ day, ...ask }) => ({ questionId: q.id, askedAt: at(day), ...ask })) });
    };
    // Not sure once, then answered from the facts: the chat copes now.
    const harga = await topic(page.pageId, 'harga', 9, '2026-10-20T00:00:00Z');
    await asks(harga.id, 'harga?', [
      { day: 10, answered: false, reply: 'Tak pasti.' },
      { day: 12, answered: true, reply: 'RM95 sebiji.' },
      // The month's fixed reply after it says nothing either way.
      { day: 13, answered: null, reply: null },
    ]);
    await topic(page.pageId, 'hantar', 7, '2026-10-20T00:00:00Z', { answer: 'Ya' });
    await topic(page.pageId, 'halal', 5, '2026-10-20T00:00:00Z', { answer: 'Ya', conflictAnswer: 'Tidak' });
    await topic(page.pageId, 'buka', 3, '2026-10-20T00:00:00Z', { answer: '9 pagi' });
    // Answered once, then not sure: it needs the owner again. The ask with no reply after it is from before replies were kept.
    const tutup = await topic(page.pageId, 'tutup', 2, '2026-10-20T00:00:00Z');
    await asks(tutup.id, 'tutup bila?', [
      { day: 10, answered: true, reply: 'Pukul 6.' },
      { day: 12, answered: false, reply: 'Tak pasti, saya tanya Lina.' },
    ]);
    await asks(tutup.id, 'bila tutup', [{ day: 14, answered: true, reply: null }]);
    // Never replied to by the model: it needs the owner, as before.
    await topic(page.pageId, 'parking', 1, '2026-10-20T00:00:00Z');
    other = (await anOwnerWithAPage()).accountId;
  });

  it('filters before paging, so each filter pages through every topic it matches', async () => {
    const titles = async (show: 'needs' | 'chat' | 'answered', offset: number) =>
      (await getTopics(owner, { show, limit: 2, offset })).map((t) => t.title);
    expect(await titles('needs', 0)).toEqual(['halal', 'tutup']);
    expect(await titles('needs', 2)).toEqual(['parking']);
    expect(await titles('chat', 0)).toEqual(['harga']);
    expect(await titles('answered', 0)).toEqual(['hantar', 'buka']);
  });

  it("carries the model's latest reply and the wording it answered, or null when it never replied", async () => {
    const topics = await getTopics(owner);
    const chat = (title: string) => topics.find((t) => t.title === title)?.chat;
    expect(chat('harga')).toEqual({ asked: 'harga?', reply: 'RM95 sebiji.', answered: true, at: at(12) });
    expect(chat('tutup')).toEqual({ asked: 'tutup bila?', reply: 'Tak pasti, saya tanya Lina.', answered: false, at: at(12) });
    expect(chat('parking')).toBeNull();
    expect(chat('hantar')).toBeNull();
  });

  it("counts each filter's topics and the asks across all of them, and only this owner's", async () => {
    expect(await getTopicTotals(owner)).toEqual({ topics: { all: 6, needs: 3, chat: 1, answered: 2 }, asks: 27, answeredAsks: 10 });
    expect(await getTopicTotals(other)).toEqual({ topics: { all: 0, needs: 0, chat: 0, answered: 0 }, asks: 0, answeredAsks: 0 });
    expect(await countTopicsNeedingOwner(owner)).toBe(3);
  });

  it('lists every topic to merge into, most asked first', async () => {
    expect((await getTopicChoices(owner)).map((t) => t.title)).toEqual(['harga', 'hantar', 'halal', 'buka', 'tutup', 'parking']);
    expect(await getTopicChoices(other)).toEqual([]);
  });
});
