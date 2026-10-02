import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// `@prisma/client`, not `@curios/db` -- every test in apps/api constructs its
// own client this way, pointed at DATABASE_URL_TEST. Source files import the
// type from `@curios/db`; tests import the constructor from Prisma directly.
import { PrismaClient } from '@prisma/client';
import { assignTopicSlug } from './faq-slug.js';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
});

async function seed(input: {
  mode?: 'PERSONAL' | 'BUSINESS';
  askCount: number;
  answered: boolean;
  text?: string;
}) {
  const account = await prisma.account.create({
    data: { email: `faq-${randomUUID()}@example.com` },
    select: { id: true },
  });
  const skeleton = `faq-${randomUUID().slice(0, 8)}`;
  const page = await prisma.page.create({
    data: {
      accountId: account.id,
      handle: skeleton,
      skeleton,
      displayName: 'Nadia Bakes',
      mode: input.mode ?? 'BUSINESS',
    },
    select: { id: true },
  });
  const text = input.text ?? 'Berapa harga kek lapis?';
  const topic = await prisma.topic.create({
    data: {
      pageId: page.id,
      title: text,
      askCount: input.askCount,
      answer: input.answered ? 'RM12 sekotak.' : null,
      answeredAt: input.answered ? new Date() : null,
    },
    select: { id: true },
  });
  return { pageId: page.id, topicId: topic.id };
}

const slugOf = (id: string) =>
  prisma.topic.findUniqueOrThrow({ where: { id }, select: { faqSlug: true } });

describe('assignTopicSlug', () => {
  it('assigns when the owner answering is the last condition to arrive', async () => {
    // The obvious path: asked plenty, then answered.
    const { topicId } = await seed({ askCount: 5, answered: true });

    await assignTopicSlug(prisma, topicId);

    expect((await slugOf(topicId)).faqSlug).toBe('berapa-harga-kek-lapis');
  });

  it('assigns when the third ask is the last condition to arrive', async () => {
    // The path an implementation forgets. A topic answered while it had two
    // asks qualifies on its third, and nothing about that ask involves the
    // owner -- so if only the writeback assigns slugs, this topic never
    // gets a page and nobody can explain why.
    const { topicId } = await seed({ askCount: 3, answered: true });

    await assignTopicSlug(prisma, topicId);

    expect((await slugOf(topicId)).faqSlug).toBe('berapa-harga-kek-lapis');
  });

  it('leaves a topic one ask short alone', async () => {
    const { topicId } = await seed({ askCount: 2, answered: true });

    await assignTopicSlug(prisma, topicId);

    expect((await slugOf(topicId)).faqSlug).toBeNull();
  });

  it('leaves an unanswered topic alone however often it is asked', async () => {
    const { topicId } = await seed({ askCount: 40, answered: false });

    await assignTopicSlug(prisma, topicId);

    expect((await slugOf(topicId)).faqSlug).toBeNull();
  });

  it('never gives a personal page a public FAQ URL', async () => {
    const { topicId } = await seed({ mode: 'PERSONAL', askCount: 9, answered: true });

    await assignTopicSlug(prisma, topicId);

    expect((await slugOf(topicId)).faqSlug).toBeNull();
  });

  it('does not overwrite a slug it has already assigned', async () => {
    // URL stability. Re-running must be a no-op, because both call sites can
    // fire for the same topic many times over its life.
    const { topicId } = await seed({ askCount: 5, answered: true });
    await prisma.topic.update({ where: { id: topicId }, data: { faqSlug: 'the-original' } });

    await assignTopicSlug(prisma, topicId);

    expect((await slugOf(topicId)).faqSlug).toBe('the-original');
  });

  it('never overwrites a slug another writer set between its read and its write', async () => {
    const { topicId } = await seed({ askCount: 5, answered: true });
    // The slug lands (say, from a merge) after assignTopicSlug has read the
    // topic as unnamed, while it is reading the taken names.
    const racing = new Proxy(prisma, {
      get(target, key, receiver) {
        if (key !== 'faqRedirect') return Reflect.get(target, key, receiver);
        return new Proxy(target.faqRedirect, {
          get(redirects, method, r) {
            if (method !== 'findMany') return Reflect.get(redirects, method, r);
            return async (args: never) => {
              await target.topic.update({ where: { id: topicId }, data: { faqSlug: 'set-first' } });
              return redirects.findMany(args);
            };
          },
        });
      },
    }) as PrismaClient;

    await assignTopicSlug(racing, topicId);

    expect((await slugOf(topicId)).faqSlug).toBe('set-first');
  });

  it('suffixes a slug another topic on the same page already holds', async () => {
    const { pageId, topicId } = await seed({ askCount: 5, answered: true });
    await prisma.topic.create({
      data: { pageId, title: 'Berapa, harga kek lapis!', faqSlug: 'berapa-harga-kek-lapis' },
    });

    await assignTopicSlug(prisma, topicId);

    expect((await slugOf(topicId)).faqSlug).toBe('berapa-harga-kek-lapis-2');
  });

  it('returns quietly for a topic that no longer exists', async () => {
    // Best-effort by design: this runs inside a visitor's chat request, and a
    // deleted page mid-request must not turn into a 500 for them.
    //
    // NOTE: a bad id makes the real `findUnique` resolve to `null`, which
    // takes the early `if (!topic ...) return;` branch a few lines into
    // the try. It never reaches the outer catch below -- that is a distinct
    // branch, covered by the next test. Do not merge these as duplicates.
    await expect(assignTopicSlug(prisma, 'cl-does-not-exist')).resolves.toBeUndefined();
  });

  it('logs and resolves rather than throwing when the database call itself fails', async () => {
    // The branch the test above does NOT reach: here `findUnique` rejects
    // outright (a dropped connection, a timeout), which is what the outer
    // `catch` in `assignTopicSlug` exists for -- "a failure logs and returns,
    // never propagates," because this runs inside a visitor's SSE stream and
    // an owner's answer-writeback, and neither may fail because an SEO URL
    // could not be minted.
    const errors: string[] = [];
    const log = { error: (_obj: unknown, msg: string) => errors.push(msg) };
    const failing = {
      topic: { findUnique: vi.fn().mockRejectedValue(new Error('connection lost')) },
    } as unknown as PrismaClient;

    await expect(assignTopicSlug(failing, 'any-id', log)).resolves.toBeUndefined();
    expect(errors).toEqual(['faq slug assignment failed']);
  });

  it('reports an unsluggable topic to the log instead of skipping it silently', async () => {
    const errors: string[] = [];
    const log = { error: (_obj: unknown, msg: string) => errors.push(msg) };
    const { topicId } = await seed({ askCount: 5, answered: true, text: '???!!!' });

    // A topic with nothing sluggable cannot get a URL. That is not worth
    // failing a request over, but it must not be silent either -- a qualifying
    // topic with no page and no log line is unexplainable from the outside.
    await expect(assignTopicSlug(prisma, topicId, log)).resolves.toBeUndefined();
    expect((await slugOf(topicId)).faqSlug).toBeNull();
    // Asserting the log, not just the absence of a slug. Without this the test
    // passes against an implementation that drops the topic on the floor,
    // which is the behaviour the `log` parameter exists to prevent.
    expect(errors).toEqual(['topic has no sluggable text; no faq url assigned']);
  });
});

describe('retired slugs', () => {
  // Review Focus 4: a retired slug is never handed to another topic.
  it('treats a retired slug as taken', async () => {
    const { pageId, topicId } = await seed({ askCount: 5, answered: true, text: 'Kek berapa' });
    await prisma.faqRedirect.create({ data: { pageId, slug: 'kek-berapa', topicId: null } });

    await assignTopicSlug(prisma, topicId);

    expect((await slugOf(topicId)).faqSlug).toBe('kek-berapa-2');
  });
});
