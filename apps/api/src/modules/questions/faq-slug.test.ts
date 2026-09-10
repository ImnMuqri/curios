import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// `@prisma/client`, not `@curios/db` -- every test in apps/api constructs its
// own client this way, pointed at DATABASE_URL_TEST. Source files import the
// type from `@curios/db`; tests import the constructor from Prisma directly.
import { PrismaClient } from '@prisma/client';
import { assignFaqSlug } from './faq-slug.js';

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
  const question = await prisma.question.create({
    data: {
      pageId: page.id,
      text,
      normalizedQuestion: text.toLowerCase(),
      askCount: input.askCount,
      answered: input.answered,
    },
    select: { id: true },
  });
  return { pageId: page.id, questionId: question.id };
}

const slugOf = (id: string) =>
  prisma.question.findUniqueOrThrow({ where: { id }, select: { faqSlug: true } });

describe('assignFaqSlug', () => {
  it('assigns when the owner answering is the last condition to arrive', async () => {
    // The obvious path: asked plenty, then answered.
    const { questionId } = await seed({ askCount: 5, answered: true });

    await assignFaqSlug(prisma, questionId);

    expect((await slugOf(questionId)).faqSlug).toBe('berapa-harga-kek-lapis');
  });

  it('assigns when the third ask is the last condition to arrive', async () => {
    // The path an implementation forgets. A question answered while it had two
    // asks qualifies on its third, and nothing about that ask involves the
    // owner -- so if only the writeback assigns slugs, this question never
    // gets a page and nobody can explain why.
    const { questionId } = await seed({ askCount: 3, answered: true });

    await assignFaqSlug(prisma, questionId);

    expect((await slugOf(questionId)).faqSlug).toBe('berapa-harga-kek-lapis');
  });

  it('leaves a question one ask short alone', async () => {
    const { questionId } = await seed({ askCount: 2, answered: true });

    await assignFaqSlug(prisma, questionId);

    expect((await slugOf(questionId)).faqSlug).toBeNull();
  });

  it('leaves an unanswered question alone however often it is asked', async () => {
    const { questionId } = await seed({ askCount: 40, answered: false });

    await assignFaqSlug(prisma, questionId);

    expect((await slugOf(questionId)).faqSlug).toBeNull();
  });

  it('never gives a personal page a public FAQ URL', async () => {
    const { questionId } = await seed({ mode: 'PERSONAL', askCount: 9, answered: true });

    await assignFaqSlug(prisma, questionId);

    expect((await slugOf(questionId)).faqSlug).toBeNull();
  });

  it('does not overwrite a slug it has already assigned', async () => {
    // URL stability. Re-running must be a no-op, because both call sites can
    // fire for the same question many times over its life.
    const { questionId } = await seed({ askCount: 5, answered: true });
    await prisma.question.update({ where: { id: questionId }, data: { faqSlug: 'the-original' } });

    await assignFaqSlug(prisma, questionId);

    expect((await slugOf(questionId)).faqSlug).toBe('the-original');
  });

  it('suffixes a slug another question on the same page already holds', async () => {
    const { pageId, questionId } = await seed({ askCount: 5, answered: true });
    await prisma.question.create({
      data: {
        pageId,
        text: 'Berapa, harga kek lapis!',
        normalizedQuestion: 'berapa harga kek lapis different',
        faqSlug: 'berapa-harga-kek-lapis',
      },
    });

    await assignFaqSlug(prisma, questionId);

    expect((await slugOf(questionId)).faqSlug).toBe('berapa-harga-kek-lapis-2');
  });

  it('returns quietly for a question that no longer exists', async () => {
    // Best-effort by design: this runs inside a visitor's chat request, and a
    // deleted page mid-request must not turn into a 500 for them.
    //
    // NOTE: a bad id makes the real `findUnique` resolve to `null`, which
    // takes the early `if (!question ...) return;` branch a few lines into
    // the try. It never reaches the outer catch below -- that is a distinct
    // branch, covered by the next test. Do not merge these as duplicates.
    await expect(assignFaqSlug(prisma, 'cl-does-not-exist')).resolves.toBeUndefined();
  });

  it('logs and resolves rather than throwing when the database call itself fails', async () => {
    // The branch the test above does NOT reach: here `findUnique` rejects
    // outright (a dropped connection, a timeout), which is what the outer
    // `catch` in `assignFaqSlug` exists for -- "a failure logs and returns,
    // never propagates," because this runs inside a visitor's SSE stream and
    // an owner's answer-writeback, and neither may fail because an SEO URL
    // could not be minted.
    const errors: string[] = [];
    const log = { error: (_obj: unknown, msg: string) => errors.push(msg) };
    const failing = {
      question: { findUnique: vi.fn().mockRejectedValue(new Error('connection lost')) },
    } as unknown as PrismaClient;

    await expect(assignFaqSlug(failing, 'any-id', log)).resolves.toBeUndefined();
    expect(errors).toEqual(['faq slug assignment failed']);
  });

  it('reports an unsluggable question to the log instead of skipping it silently', async () => {
    const errors: string[] = [];
    const log = { error: (_obj: unknown, msg: string) => errors.push(msg) };
    const { questionId } = await seed({ askCount: 5, answered: true, text: '???!!!' });

    // A question with nothing sluggable cannot get a URL. That is not worth
    // failing a request over, but it must not be silent either -- a qualifying
    // question with no page and no log line is unexplainable from the outside.
    await expect(assignFaqSlug(prisma, questionId, log)).resolves.toBeUndefined();
    expect((await slugOf(questionId)).faqSlug).toBeNull();
    // Asserting the log, not just the absence of a slug. Without this the test
    // passes against an implementation that drops the question on the floor,
    // which is the behaviour the `log` parameter exists to prevent.
    expect(errors).toEqual(['question has no sluggable text; no faq url assigned']);
  });
});

describe('both write sites', () => {
  it('assigns a slug through the answer writeback', async () => {
    const { questionId } = await seed({ askCount: 5, answered: false });
    const account = await prisma.question.findUniqueOrThrow({
      where: { id: questionId },
      select: { page: { select: { accountId: true } } },
    });

    const { answerQuestion } = await import('./question.service.js');
    await answerQuestion(prisma, account.page.accountId, questionId, 'RM12 sekotak.');

    expect((await slugOf(questionId)).faqSlug).toBe('berapa-harga-kek-lapis');
  });
});
