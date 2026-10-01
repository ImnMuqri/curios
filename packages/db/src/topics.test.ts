import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { MergeWouldDropAnswerError, mergeTopics, moveWording, refreshTopic, retireSlug } from './topics.js';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
});
afterAll(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
  await prisma.$disconnect();
});

let n = 0;
async function aPage() {
  n += 1;
  const account = await prisma.account.create({
    data: { email: `tp${n}@example.com`, pages: { create: { handle: `tp${n}`, skeleton: `tp${n}`, displayName: 'T' } } },
    include: { pages: true },
  });
  return account.pages[0]!.id;
}

async function aTopic(pageId: string, wordings: { text: string; askCount: number; firstAskedAt?: Date }[], extra: Record<string, unknown> = {}) {
  const topic = await prisma.topic.create({ data: { pageId, title: wordings[0]!.text, ...extra } });
  for (const w of wordings) {
    await prisma.question.create({
      data: { pageId, topicId: topic.id, text: w.text, normalizedQuestion: w.text.toLowerCase(), askCount: w.askCount, firstAskedAt: w.firstAskedAt ?? new Date() },
    });
  }
  await refreshTopic(prisma, topic.id);
  return prisma.topic.findUniqueOrThrow({ where: { id: topic.id } });
}

describe('refreshTopic', () => {
  // Review Focus 3: recomputed, never incremented.
  it('sets askCount to the sum of its wordings, whatever it held before', async () => {
    const pageId = await aPage();
    const topic = await aTopic(pageId, [{ text: 'a', askCount: 2 }, { text: 'b', askCount: 3 }]);
    await prisma.topic.update({ where: { id: topic.id }, data: { askCount: 999 } });
    await refreshTopic(prisma, topic.id);
    expect((await prisma.topic.findUniqueOrThrow({ where: { id: topic.id } })).askCount).toBe(5);
  });

  it('sets lastAskedAt to the latest of its wordings', async () => {
    const pageId = await aPage();
    const topic = await aTopic(pageId, [{ text: 'a', askCount: 1 }, { text: 'b', askCount: 1 }]);
    const latest = new Date('2030-01-01T00:00:00Z');
    await prisma.question.updateMany({ where: { topicId: topic.id, text: 'b' }, data: { lastAskedAt: latest } });
    await refreshTopic(prisma, topic.id);
    expect((await prisma.topic.findUniqueOrThrow({ where: { id: topic.id } })).lastAskedAt).toEqual(latest);
  });

  it('titles the topic with its most-asked wording, ties to the earliest', async () => {
    const pageId = await aPage();
    const topic = await aTopic(pageId, [
      { text: 'later', askCount: 3, firstAskedAt: new Date('2026-02-01') },
      { text: 'earlier', askCount: 3, firstAskedAt: new Date('2026-01-01') },
      { text: 'rare', askCount: 1 },
    ]);
    expect(topic.title).toBe('earlier');
  });

  it('keeps an owner-set title', async () => {
    const pageId = await aPage();
    const topic = await aTopic(pageId, [{ text: 'x', askCount: 9 }], { title: 'Mine', titleSetByOwner: true });
    await refreshTopic(prisma, topic.id);
    expect((await prisma.topic.findUniqueOrThrow({ where: { id: topic.id } })).title).toBe('Mine');
  });

  // Review Focus 4.
  it('deletes an empty topic and retires its slug with no target', async () => {
    const pageId = await aPage();
    const topic = await prisma.topic.create({ data: { pageId, title: 'gone', faqSlug: 'gone' } });
    await expect(refreshTopic(prisma, topic.id)).resolves.toBe(false);
    expect(await prisma.topic.findUnique({ where: { id: topic.id } })).toBeNull();
    expect(await prisma.faqRedirect.findUnique({ where: { pageId_slug: { pageId, slug: 'gone' } } })).toMatchObject({ topicId: null });
  });
});

describe('mergeTopics', () => {
  it('moves every wording, recomputes, and deletes the source', async () => {
    const pageId = await aPage();
    const from = await aTopic(pageId, [{ text: 'his full name', askCount: 2 }]);
    const into = await aTopic(pageId, [{ text: 'Iman full name', askCount: 4 }]);
    await mergeTopics(prisma, { fromTopicId: from.id, intoTopicId: into.id, answer: 'into' });
    expect(await prisma.topic.findUnique({ where: { id: from.id } })).toBeNull();
    const merged = await prisma.topic.findUniqueOrThrow({ where: { id: into.id }, include: { questions: true } });
    expect(merged.askCount).toBe(6);
    expect(merged.questions.map((q) => q.text).sort()).toEqual(['Iman full name', 'his full name']);
  });

  it('keeps the named side’s answer', async () => {
    const pageId = await aPage();
    const from = await aTopic(pageId, [{ text: 'a', askCount: 1 }], { answer: 'FROM' });
    const into = await aTopic(pageId, [{ text: 'b', askCount: 1 }], { answer: 'INTO' });
    await mergeTopics(prisma, { fromTopicId: from.id, intoTopicId: into.id, answer: 'from' });
    expect(await prisma.topic.findUniqueOrThrow({ where: { id: into.id } })).toMatchObject({ answer: 'FROM', conflictAnswer: null });
  });

  it("on 'auto', keeps the more-asked answer and holds the other as a conflict", async () => {
    const pageId = await aPage();
    const from = await aTopic(pageId, [{ text: 'a', askCount: 9 }], { answer: 'BUSY' });
    const into = await aTopic(pageId, [{ text: 'b', askCount: 1 }], { answer: 'QUIET' });
    await mergeTopics(prisma, { fromTopicId: from.id, intoTopicId: into.id, answer: 'auto' });
    expect(await prisma.topic.findUniqueOrThrow({ where: { id: into.id } })).toMatchObject({ answer: 'BUSY', conflictAnswer: 'QUIET' });
  });

  it("on 'auto', takes the only answer there is without a conflict", async () => {
    const pageId = await aPage();
    const from = await aTopic(pageId, [{ text: 'a', askCount: 1 }], { answer: 'ONLY' });
    const into = await aTopic(pageId, [{ text: 'b', askCount: 5 }]);
    await mergeTopics(prisma, { fromTopicId: from.id, intoTopicId: into.id, answer: 'auto' });
    expect(await prisma.topic.findUniqueOrThrow({ where: { id: into.id } })).toMatchObject({ answer: 'ONLY', conflictAnswer: null });
  });

  // Review Focus 5.
  it('keeps the survivor’s slug and redirects the other to it', async () => {
    const pageId = await aPage();
    const from = await aTopic(pageId, [{ text: 'a', askCount: 1 }], { faqSlug: 'from-slug' });
    const into = await aTopic(pageId, [{ text: 'b', askCount: 1 }], { faqSlug: 'into-slug' });
    await mergeTopics(prisma, { fromTopicId: from.id, intoTopicId: into.id, answer: 'into' });
    expect((await prisma.topic.findUniqueOrThrow({ where: { id: into.id } })).faqSlug).toBe('into-slug');
    expect(await prisma.faqRedirect.findUnique({ where: { pageId_slug: { pageId, slug: 'from-slug' } } })).toMatchObject({ topicId: into.id });
  });

  it('gives the survivor the other slug when it had none', async () => {
    const pageId = await aPage();
    const from = await aTopic(pageId, [{ text: 'a', askCount: 1 }], { faqSlug: 'only-slug' });
    const into = await aTopic(pageId, [{ text: 'b', askCount: 1 }]);
    await mergeTopics(prisma, { fromTopicId: from.id, intoTopicId: into.id, answer: 'into' });
    expect((await prisma.topic.findUniqueOrThrow({ where: { id: into.id } })).faqSlug).toBe('only-slug');
    expect(await prisma.faqRedirect.count({ where: { pageId } })).toBe(0);
  });

  it('re-points earlier redirects that targeted the source at the survivor', async () => {
    const pageId = await aPage();
    const from = await aTopic(pageId, [{ text: 'a', askCount: 1 }]);
    const into = await aTopic(pageId, [{ text: 'b', askCount: 1 }]);
    await retireSlug(prisma, pageId, 'old-from', from.id);
    await mergeTopics(prisma, { fromTopicId: from.id, intoTopicId: into.id, answer: 'into' });
    expect(await prisma.faqRedirect.findUnique({ where: { pageId_slug: { pageId, slug: 'old-from' } } })).toMatchObject({ topicId: into.id });
  });

  it('refuses to merge a topic into itself', async () => {
    const t = await aTopic(await aPage(), [{ text: 'a', askCount: 1 }]);
    await expect(mergeTopics(prisma, { fromTopicId: t.id, intoTopicId: t.id, answer: 'into' })).rejects.toThrow();
    expect(await prisma.topic.findUnique({ where: { id: t.id } })).not.toBeNull();
  });

  it("on 'auto', keeps into's answer when from has none", async () => {
    const pageId = await aPage();
    const from = await aTopic(pageId, [{ text: 'a', askCount: 9 }]);
    const into = await aTopic(pageId, [{ text: 'b', askCount: 1 }], { answer: 'MINE' });
    await mergeTopics(prisma, { fromTopicId: from.id, intoTopicId: into.id, answer: 'auto' });
    expect(await prisma.topic.findUniqueOrThrow({ where: { id: into.id } })).toMatchObject({ answer: 'MINE', conflictAnswer: null });
  });

  it('keeps a hidden page hidden when the survivor takes its slug', async () => {
    const pageId = await aPage();
    const from = await aTopic(pageId, [{ text: 'a', askCount: 1 }], { faqSlug: 'hidden', faqSuppressed: true, answer: 'A' });
    const into = await aTopic(pageId, [{ text: 'b', askCount: 1 }]);
    await mergeTopics(prisma, { fromTopicId: from.id, intoTopicId: into.id, answer: 'auto' });
    expect(await prisma.topic.findUniqueOrThrow({ where: { id: into.id } })).toMatchObject({ faqSlug: 'hidden', faqSuppressed: true });
  });

  it('keeps its own flag when both are slugged: the survivor page stays, the other redirects to it', async () => {
    const pageId = await aPage();
    const from = await aTopic(pageId, [{ text: 'a', askCount: 1 }], { faqSlug: 'from-slug', faqSuppressed: true });
    const into = await aTopic(pageId, [{ text: 'b', askCount: 1 }], { faqSlug: 'into-slug' });
    await mergeTopics(prisma, { fromTopicId: from.id, intoTopicId: into.id, answer: 'into' });
    expect(await prisma.topic.findUniqueOrThrow({ where: { id: into.id } })).toMatchObject({ faqSlug: 'into-slug', faqSuppressed: false });
    expect(await prisma.faqRedirect.findUnique({ where: { pageId_slug: { pageId, slug: 'from-slug' } } })).toMatchObject({ topicId: into.id });
  });

  it("on 'auto', refuses when the survivor already holds a conflict and the source has an answer, writing nothing", async () => {
    const pageId = await aPage();
    const from = await aTopic(pageId, [{ text: 'a', askCount: 1 }], { answer: 'THIRD' });
    const into = await aTopic(pageId, [{ text: 'b', askCount: 1 }], { answer: 'FIRST', conflictAnswer: 'SECOND' });
    await expect(mergeTopics(prisma, { fromTopicId: from.id, intoTopicId: into.id, answer: 'auto' })).rejects.toBeInstanceOf(MergeWouldDropAnswerError);
    expect(await prisma.topic.findUnique({ where: { id: from.id } })).not.toBeNull();
    expect(await prisma.topic.findUniqueOrThrow({ where: { id: into.id } })).toMatchObject({ answer: 'FIRST', conflictAnswer: 'SECOND', askCount: 1 });
    expect((await prisma.question.findFirstOrThrow({ where: { text: 'a' } })).topicId).toBe(from.id);
  });

  it("on 'auto', refuses when the source holds a conflict of its own, writing nothing", async () => {
    const pageId = await aPage();
    const from = await aTopic(pageId, [{ text: 'a', askCount: 1 }], { answer: 'ONE', conflictAnswer: 'TWO' });
    const into = await aTopic(pageId, [{ text: 'b', askCount: 1 }]);
    await expect(mergeTopics(prisma, { fromTopicId: from.id, intoTopicId: into.id, answer: 'auto' })).rejects.toBeInstanceOf(MergeWouldDropAnswerError);
    expect(await prisma.topic.findUnique({ where: { id: from.id } })).toMatchObject({ conflictAnswer: 'TWO' });
    expect((await prisma.question.findFirstOrThrow({ where: { text: 'a' } })).topicId).toBe(from.id);
  });

  it("on 'auto', still merges when the survivor holds a conflict but the source has no answer", async () => {
    const pageId = await aPage();
    const from = await aTopic(pageId, [{ text: 'a', askCount: 1 }]);
    const into = await aTopic(pageId, [{ text: 'b', askCount: 1 }], { answer: 'FIRST', conflictAnswer: 'SECOND' });
    await mergeTopics(prisma, { fromTopicId: from.id, intoTopicId: into.id, answer: 'auto' });
    expect(await prisma.topic.findUniqueOrThrow({ where: { id: into.id } })).toMatchObject({ answer: 'FIRST', conflictAnswer: 'SECOND', askCount: 2 });
  });

  it("an owner's merge ('from') may drop the source's conflict: it is their choice", async () => {
    const pageId = await aPage();
    const from = await aTopic(pageId, [{ text: 'a', askCount: 1 }], { answer: 'ONE', conflictAnswer: 'TWO' });
    const into = await aTopic(pageId, [{ text: 'b', askCount: 1 }], { answer: 'KEEP', conflictAnswer: 'OTHER' });
    await mergeTopics(prisma, { fromTopicId: from.id, intoTopicId: into.id, answer: 'from' });
    expect(await prisma.topic.findUniqueOrThrow({ where: { id: into.id } })).toMatchObject({ answer: 'ONE' });
  });

  it('refuses to merge across pages', async () => {
    const a = await aTopic(await aPage(), [{ text: 'a', askCount: 1 }]);
    const b = await aTopic(await aPage(), [{ text: 'b', askCount: 1 }]);
    await expect(mergeTopics(prisma, { fromTopicId: a.id, intoTopicId: b.id, answer: 'into' })).rejects.toThrow();
  });
});

describe('moveWording', () => {
  it('moves one wording and refreshes both topics', async () => {
    const pageId = await aPage();
    const from = await aTopic(pageId, [{ text: 'stay', askCount: 5 }, { text: 'go', askCount: 2 }]);
    const into = await aTopic(pageId, [{ text: 'there', askCount: 1 }]);
    const go = await prisma.question.findFirstOrThrow({ where: { text: 'go' } });
    await moveWording(prisma, { questionId: go.id, intoTopicId: into.id });
    expect((await prisma.topic.findUniqueOrThrow({ where: { id: from.id } })).askCount).toBe(5);
    expect((await prisma.topic.findUniqueOrThrow({ where: { id: into.id } })).askCount).toBe(3);
  });
});

describe('moveWording guards', () => {
  it("refuses another page's topic", async () => {
    const a = await aTopic(await aPage(), [{ text: 'a', askCount: 1 }]);
    const b = await aTopic(await aPage(), [{ text: 'b', askCount: 1 }]);
    const q = await prisma.question.findFirstOrThrow({ where: { topicId: a.id } });
    await expect(moveWording(prisma, { questionId: q.id, intoTopicId: b.id })).rejects.toThrow();
    expect((await prisma.question.findUniqueOrThrow({ where: { id: q.id } })).topicId).toBe(a.id);
  });
});

describe('refreshTopic under a racing merge', () => {
  // Review Focus 3. A merge has moved wordings into T but not yet committed;
  // a refresh of T starts meanwhile. Without the row lock it counts only the
  // wordings it can see and, once the merge commits, writes that short sum.
  it('never writes a count that omits a merge still in flight', async () => {
    const other = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });
    try {
      const pageId = await aPage();
      const into = await aTopic(pageId, [{ text: 'stays', askCount: 1 }]);
      const from = await aTopic(pageId, [{ text: 'moves', askCount: 10 }]);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let moved!: () => void;
      const movedDone = new Promise<void>((resolve) => (moved = resolve));

      const merge = prisma.$transaction(async (tx) => {
        await mergeTopics(tx, { fromTopicId: from.id, intoTopicId: into.id, answer: 'into' });
        moved();
        await gate;
      });
      await movedDone;

      const chat = other.$transaction(async (tx) => {
        await tx.question.updateMany({ where: { topicId: into.id, text: 'stays' }, data: { askCount: { increment: 1 } } });
        await refreshTopic(tx, into.id);
      });
      await new Promise((resolve) => setTimeout(resolve, 400)); // let the chat reach its wait
      release();
      await Promise.all([merge, chat]);

      expect((await prisma.topic.findUniqueOrThrow({ where: { id: into.id } })).askCount).toBe(12);
    } finally {
      await other.$disconnect();
    }
  });
});

describe('refreshTopic title tie-break', () => {
  it('titles by the lower id when askCount and firstAskedAt both tie', async () => {
    const pageId = await aPage();
    const at = new Date('2026-01-01');
    const topic = await prisma.topic.create({ data: { pageId, title: 'x' } });
    const ids = ['q-bbb', 'q-aaa'];
    for (const id of ids) {
      await prisma.question.create({ data: { id, pageId, topicId: topic.id, text: id, normalizedQuestion: id, askCount: 2, firstAskedAt: at } });
    }
    await refreshTopic(prisma, topic.id);
    expect((await prisma.topic.findUniqueOrThrow({ where: { id: topic.id } })).title).toBe('q-aaa');
  });
});

describe('retireSlug', () => {
  it('re-points an already-retired slug rather than failing', async () => {
    const pageId = await aPage();
    const t = await aTopic(pageId, [{ text: 'a', askCount: 1 }]);
    await retireSlug(prisma, pageId, 's', null);
    await retireSlug(prisma, pageId, 's', t.id);
    expect(await prisma.faqRedirect.findUnique({ where: { pageId_slug: { pageId, slug: 's' } } })).toMatchObject({ topicId: t.id });
  });
});
