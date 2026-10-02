import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { refreshTopic } from '@curios/db';
import {
  AlreadyAloneError,
  answerTopic,
  deleteTopic,
  deleteWording,
  mergeTopic,
  NoConflictError,
  renameTopic,
  resolveConflict,
  setTopicSuppressed,
  splitWording,
  TopicNotFoundError,
  withdrawTopicAnswer,
} from './topic.service.js';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
});
afterAll(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
  await prisma.$disconnect();
});

async function anOwner(mode: 'PERSONAL' | 'BUSINESS' = 'PERSONAL') {
  const slug = randomUUID().slice(0, 8);
  const account = await prisma.account.create({
    data: {
      email: `ts-${randomUUID()}@example.com`,
      pages: { create: { handle: `ts-${slug}`, skeleton: `ts-${slug}`, displayName: 'T', mode } },
    },
    select: { id: true, pages: { select: { id: true } } },
  });
  return { accountId: account.id, pageId: account.pages[0]!.id };
}

async function aTopic(
  pageId: string,
  wordings: { text: string; askCount: number; firstAskedAt?: Date }[],
  extra: Record<string, unknown> = {},
) {
  const topic = await prisma.topic.create({ data: { pageId, title: wordings[0]!.text, ...extra } });
  const questions = [];
  for (const w of wordings) {
    questions.push(
      await prisma.question.create({
        data: {
          pageId,
          topicId: topic.id,
          text: w.text,
          normalizedQuestion: `${w.text.toLowerCase()}-${randomUUID().slice(0, 6)}`,
          askCount: w.askCount,
          firstAskedAt: w.firstAskedAt ?? new Date(),
        },
      }),
    );
  }
  await refreshTopic(prisma, topic.id);
  return { id: topic.id, questions };
}

const topicRow = (id: string) => prisma.topic.findUniqueOrThrow({ where: { id } });

describe('answerTopic', () => {
  it('sets the answer, stamps answeredAt and clears a conflict', async () => {
    const { accountId, pageId } = await anOwner();
    const t = await aTopic(pageId, [{ text: 'harga kek', askCount: 1 }], { conflictAnswer: 'old rival' });
    const before = Date.now();

    await answerTopic(prisma, accountId, t.id, 'RM95 sekilo.');

    const row = await topicRow(t.id);
    expect(row.answer).toBe('RM95 sekilo.');
    expect(row.answeredAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(row.conflictAnswer).toBeNull();
  });

  it('trims, and refuses an empty or over-long answer (500 emoji ok, 2001 chars refused)', async () => {
    const { accountId, pageId } = await anOwner();
    const t = await aTopic(pageId, [{ text: 'harga kek', askCount: 1 }]);

    await answerTopic(prisma, accountId, t.id, '  RM95.  ');
    expect((await topicRow(t.id)).answer).toBe('RM95.');

    // 500 emoji are 1000 UTF-16 units but 500 characters: within the limit.
    const emoji = '😀'.repeat(500);
    await answerTopic(prisma, accountId, t.id, emoji);
    expect((await topicRow(t.id)).answer).toBe(emoji);

    for (const bad of ['', '   ', 'x'.repeat(2001)]) {
      await expect(answerTopic(prisma, accountId, t.id, bad)).rejects.toMatchObject({
        code: 'INVALID_ANSWER',
        statusCode: 400,
      });
    }
    // The refusals wrote nothing.
    expect((await topicRow(t.id)).answer).toBe(emoji);
    // 2000 exactly is fine.
    await answerTopic(prisma, accountId, t.id, 'x'.repeat(2000));
    expect((await topicRow(t.id)).answer).toHaveLength(2000);
  });

  it('assigns a slug once the topic qualifies', async () => {
    const { accountId, pageId } = await anOwner('BUSINESS');
    const t = await aTopic(pageId, [{ text: 'Berapa harga kek?', askCount: 3 }]);
    expect((await topicRow(t.id)).faqSlug).toBeNull();

    await answerTopic(prisma, accountId, t.id, 'RM95 sekilo.');

    expect((await topicRow(t.id)).faqSlug).toBe('berapa-harga-kek');
  });

  it('is a not-found for another owner’s topic, and writes nothing', async () => {
    const mine = await anOwner();
    const theirs = await anOwner();
    const t = await aTopic(theirs.pageId, [{ text: 'harga kek', askCount: 1 }]);

    await expect(answerTopic(prisma, mine.accountId, t.id, 'mine now')).rejects.toBeInstanceOf(TopicNotFoundError);

    const row = await topicRow(t.id);
    expect(row.answer).toBeNull();
    expect(row.answeredAt).toBeNull();
  });
});

describe('withdrawTopicAnswer', () => {
  it('clears answer, answeredAt and conflictAnswer, and keeps the slug', async () => {
    const { accountId, pageId } = await anOwner('BUSINESS');
    const t = await aTopic(pageId, [{ text: 'harga kek', askCount: 4 }], {
      answer: 'RM95.',
      answeredAt: new Date(),
      conflictAnswer: 'RM90.',
      faqSlug: 'harga-kek',
    });

    await withdrawTopicAnswer(prisma, accountId, t.id);

    const row = await topicRow(t.id);
    expect(row.answer).toBeNull();
    expect(row.answeredAt).toBeNull();
    expect(row.conflictAnswer).toBeNull();
    expect(row.faqSlug).toBe('harga-kek');
  });
});

describe('setTopicSuppressed', () => {
  it('flips faqSuppressed both ways', async () => {
    const { accountId, pageId } = await anOwner();
    const t = await aTopic(pageId, [{ text: 'harga kek', askCount: 1 }]);

    await setTopicSuppressed(prisma, accountId, t.id, true);
    expect((await topicRow(t.id)).faqSuppressed).toBe(true);

    await setTopicSuppressed(prisma, accountId, t.id, false);
    expect((await topicRow(t.id)).faqSuppressed).toBe(false);
  });
});

describe('renameTopic', () => {
  it('sets the title and marks it owner-set, so refreshTopic keeps it', async () => {
    const { accountId, pageId } = await anOwner();
    const t = await aTopic(pageId, [{ text: 'harga kek', askCount: 1 }]);

    await renameTopic(prisma, accountId, t.id, '  Cake prices  ');
    await refreshTopic(prisma, t.id);

    const row = await topicRow(t.id);
    expect(row.title).toBe('Cake prices');
    expect(row.titleSetByOwner).toBe(true);
  });

  it('refuses an empty or over-long title', async () => {
    const { accountId, pageId } = await anOwner();
    const t = await aTopic(pageId, [{ text: 'harga kek', askCount: 1 }]);

    for (const bad of ['', '   ', 'x'.repeat(201), 'two\nlines']) {
      await expect(renameTopic(prisma, accountId, t.id, bad)).rejects.toMatchObject({
        code: 'INVALID_TITLE',
        statusCode: 400,
      });
    }
    const row = await topicRow(t.id);
    expect(row.title).toBe('harga kek');
    expect(row.titleSetByOwner).toBe(false);
    // 200 exactly is fine.
    await renameTopic(prisma, accountId, t.id, 'x'.repeat(200));
    expect((await topicRow(t.id)).title).toHaveLength(200);
  });
});

describe('mergeTopic', () => {
  it("keeps this topic's answer on 'this' and the target's on 'into'", async () => {
    const { accountId, pageId } = await anOwner();
    const a1 = await aTopic(pageId, [{ text: 'a1', askCount: 1 }], { answer: 'from-1', answeredAt: new Date() });
    const b1 = await aTopic(pageId, [{ text: 'b1', askCount: 1 }], { answer: 'into-1', answeredAt: new Date() });
    await mergeTopic(prisma, accountId, a1.id, b1.id, 'this');
    expect((await topicRow(b1.id)).answer).toBe('from-1');
    expect(await prisma.topic.findUnique({ where: { id: a1.id } })).toBeNull();

    const a2 = await aTopic(pageId, [{ text: 'a2', askCount: 1 }], { answer: 'from-2', answeredAt: new Date() });
    const b2 = await aTopic(pageId, [{ text: 'b2', askCount: 1 }], { answer: 'into-2', answeredAt: new Date() });
    await mergeTopic(prisma, accountId, a2.id, b2.id, 'into');
    const survivor = await topicRow(b2.id);
    expect(survivor.answer).toBe('into-2');
    expect(survivor.askCount).toBe(2);
    expect(await prisma.question.count({ where: { topicId: b2.id } })).toBe(2);
  });

  it('redirects the merged topic’s slug to the survivor', async () => {
    const { accountId, pageId } = await anOwner('BUSINESS');
    const from = await aTopic(pageId, [{ text: 'from', askCount: 3 }], { faqSlug: 'from-slug', answer: 'x', answeredAt: new Date() });
    const into = await aTopic(pageId, [{ text: 'into', askCount: 3 }], { faqSlug: 'into-slug', answer: 'y', answeredAt: new Date() });

    await mergeTopic(prisma, accountId, from.id, into.id, 'into');

    expect((await topicRow(into.id)).faqSlug).toBe('into-slug');
    expect(await prisma.faqRedirect.findUnique({ where: { pageId_slug: { pageId, slug: 'from-slug' } } })).toMatchObject({
      topicId: into.id,
    });
  });

  it('is a not-found when merging into itself or into another owner’s topic', async () => {
    const mine = await anOwner();
    const theirs = await anOwner();
    const a = await aTopic(mine.pageId, [{ text: 'a', askCount: 1 }]);
    const b = await aTopic(theirs.pageId, [{ text: 'b', askCount: 1 }]);

    await expect(mergeTopic(prisma, mine.accountId, a.id, a.id, 'this')).rejects.toBeInstanceOf(TopicNotFoundError);
    await expect(mergeTopic(prisma, mine.accountId, a.id, b.id, 'this')).rejects.toBeInstanceOf(TopicNotFoundError);
    await expect(mergeTopic(prisma, mine.accountId, b.id, a.id, 'this')).rejects.toBeInstanceOf(TopicNotFoundError);

    // Nothing moved.
    expect(await prisma.topic.count()).toBe(2);
    expect(await prisma.question.count({ where: { topicId: a.id } })).toBe(1);
    expect(await prisma.question.count({ where: { topicId: b.id } })).toBe(1);
  });
});

describe('resolveConflict', () => {
  it("on 'conflict', promotes the held answer and clears it", async () => {
    const { accountId, pageId } = await anOwner();
    const t = await aTopic(pageId, [{ text: 'a', askCount: 1 }], { answer: 'current', conflictAnswer: 'held' });

    await resolveConflict(prisma, accountId, t.id, 'conflict');

    const row = await topicRow(t.id);
    expect(row.answer).toBe('held');
    expect(row.answeredAt).not.toBeNull();
    expect(row.conflictAnswer).toBeNull();
  });

  it("on 'answer', just clears the held answer", async () => {
    const { accountId, pageId } = await anOwner();
    const answeredAt = new Date('2026-01-01T00:00:00Z');
    const t = await aTopic(pageId, [{ text: 'a', askCount: 1 }], { answer: 'current', answeredAt, conflictAnswer: 'held' });

    await resolveConflict(prisma, accountId, t.id, 'answer');

    const row = await topicRow(t.id);
    expect(row.answer).toBe('current');
    expect(row.answeredAt).toEqual(answeredAt);
    expect(row.conflictAnswer).toBeNull();
  });

  it('is NO_CONFLICT when there is nothing to resolve', async () => {
    const { accountId, pageId } = await anOwner();
    const t = await aTopic(pageId, [{ text: 'a', askCount: 1 }], { answer: 'current' });

    const attempt = resolveConflict(prisma, accountId, t.id, 'conflict');
    await expect(attempt).rejects.toBeInstanceOf(NoConflictError);
    await expect(attempt).rejects.toMatchObject({ code: 'NO_CONFLICT', statusCode: 409 });
    expect((await topicRow(t.id)).answer).toBe('current');
  });

  it('is a not-found for another owner’s topic, which keeps its held answer', async () => {
    const mine = await anOwner();
    const theirs = await anOwner();
    const t = await aTopic(theirs.pageId, [{ text: 'a', askCount: 1 }], { answer: 'current', conflictAnswer: 'held' });

    await expect(resolveConflict(prisma, mine.accountId, t.id, 'conflict')).rejects.toBeInstanceOf(TopicNotFoundError);
    expect((await topicRow(t.id)).conflictAnswer).toBe('held');
  });
});

describe('deleteTopic', () => {
  it('erases the topic, its wordings and answer, and retires its slug with no target', async () => {
    const { accountId, pageId } = await anOwner('BUSINESS');
    const t = await aTopic(
      pageId,
      [{ text: 'harga kek', askCount: 2 }, { text: 'kek berapa', askCount: 1 }],
      { answer: 'RM95.', answeredAt: new Date(), faqSlug: 'harga-kek' },
    );

    await deleteTopic(prisma, accountId, t.id);

    expect(await prisma.topic.findUnique({ where: { id: t.id } })).toBeNull();
    expect(await prisma.question.count({ where: { pageId } })).toBe(0);
    expect(await prisma.faqRedirect.findUnique({ where: { pageId_slug: { pageId, slug: 'harga-kek' } } })).toMatchObject({
      topicId: null,
    });
  });

  it('is a not-found for another owner’s topic, which survives with its wordings', async () => {
    const mine = await anOwner();
    const theirs = await anOwner();
    const t = await aTopic(theirs.pageId, [{ text: 'a', askCount: 1 }]);

    await expect(deleteTopic(prisma, mine.accountId, t.id)).rejects.toBeInstanceOf(TopicNotFoundError);
    expect(await prisma.topic.count({ where: { id: t.id } })).toBe(1);
    expect(await prisma.question.count({ where: { topicId: t.id } })).toBe(1);
  });
});

describe('splitWording', () => {
  it('moves the wording to a new topic marked pinnedByOwner, with no answer and no slug', async () => {
    const { accountId, pageId } = await anOwner('BUSINESS');
    const t = await aTopic(
      pageId,
      [{ text: 'harga kek', askCount: 5 }, { text: 'kek berapa', askCount: 3 }],
      { answer: 'RM95.', answeredAt: new Date(), faqSlug: 'harga-kek' },
    );
    const moving = t.questions[1]!;

    const { topicId } = await splitWording(prisma, accountId, moving.id);

    expect(topicId).not.toBe(t.id);
    const wording = await prisma.question.findUniqueOrThrow({ where: { id: moving.id } });
    expect(wording.topicId).toBe(topicId);
    expect(wording.pinnedByOwner).toBe(true);
    expect(wording.groupedAt).not.toBeNull();
    const fresh = await topicRow(topicId);
    expect(fresh.pageId).toBe(pageId);
    expect(fresh.answer).toBeNull();
    expect(fresh.faqSlug).toBeNull();
    expect(fresh.title).toBe('kek berapa');
    expect(fresh.askCount).toBe(3);
    // The old topic keeps its answer and slug.
    const old = await topicRow(t.id);
    expect(old.answer).toBe('RM95.');
    expect(old.faqSlug).toBe('harga-kek');
  });

  it('refuses a wording that is already alone (ALREADY_ALONE)', async () => {
    const { accountId, pageId } = await anOwner();
    const t = await aTopic(pageId, [{ text: 'alone', askCount: 1 }]);

    const attempt = splitWording(prisma, accountId, t.questions[0]!.id);
    await expect(attempt).rejects.toBeInstanceOf(AlreadyAloneError);
    await expect(attempt).rejects.toMatchObject({ code: 'ALREADY_ALONE', statusCode: 400 });
    expect(await prisma.topic.count()).toBe(1);
    expect((await prisma.question.findUniqueOrThrow({ where: { id: t.questions[0]!.id } })).topicId).toBe(t.id);
  });

  it('recomputes the old topic’s count', async () => {
    const { accountId, pageId } = await anOwner();
    const t = await aTopic(pageId, [{ text: 'big', askCount: 5 }, { text: 'small', askCount: 2 }]);
    expect((await topicRow(t.id)).askCount).toBe(7);

    await splitWording(prisma, accountId, t.questions[1]!.id);

    expect((await topicRow(t.id)).askCount).toBe(5);
  });

  it('is a not-found for another owner’s wording', async () => {
    const mine = await anOwner();
    const theirs = await anOwner();
    const t = await aTopic(theirs.pageId, [{ text: 'a', askCount: 1 }, { text: 'b', askCount: 1 }]);

    await expect(splitWording(prisma, mine.accountId, t.questions[1]!.id)).rejects.toBeInstanceOf(TopicNotFoundError);
    expect(await prisma.topic.count()).toBe(1);
  });
});

describe('deleteWording', () => {
  it('deletes the row and refreshes its topic', async () => {
    const { accountId, pageId } = await anOwner();
    const t = await aTopic(pageId, [{ text: 'big', askCount: 5 }, { text: 'small', askCount: 2 }]);

    await deleteWording(prisma, accountId, t.questions[1]!.id);

    expect(await prisma.question.findUnique({ where: { id: t.questions[1]!.id } })).toBeNull();
    expect((await topicRow(t.id)).askCount).toBe(5);
  });

  it('deletes the topic when its last wording goes', async () => {
    const { accountId, pageId } = await anOwner('BUSINESS');
    const t = await aTopic(pageId, [{ text: 'only', askCount: 4 }], {
      answer: 'RM95.',
      answeredAt: new Date(),
      faqSlug: 'only',
    });

    await deleteWording(prisma, accountId, t.questions[0]!.id);

    expect(await prisma.topic.findUnique({ where: { id: t.id } })).toBeNull();
    expect(await prisma.faqRedirect.findUnique({ where: { pageId_slug: { pageId, slug: 'only' } } })).toMatchObject({
      topicId: null,
    });
  });

  it('moves the title when the title wording goes', async () => {
    const { accountId, pageId } = await anOwner();
    const t = await aTopic(pageId, [{ text: 'the title', askCount: 9 }, { text: 'the runner up', askCount: 2 }]);
    expect((await topicRow(t.id)).title).toBe('the title');

    await deleteWording(prisma, accountId, t.questions[0]!.id);

    expect((await topicRow(t.id)).title).toBe('the runner up');
  });

  it('is a not-found for another owner’s wording', async () => {
    const mine = await anOwner();
    const theirs = await anOwner();
    const t = await aTopic(theirs.pageId, [{ text: 'a', askCount: 1 }]);

    await expect(deleteWording(prisma, mine.accountId, t.questions[0]!.id)).rejects.toBeInstanceOf(TopicNotFoundError);
    expect(await prisma.question.count({ where: { topicId: t.id } })).toBe(1);
    expect(await prisma.topic.count({ where: { id: t.id } })).toBe(1);
  });
});
