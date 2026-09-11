import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { deleteQuestion, setFaqSuppressed } from './question.service.js';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
});

async function seed() {
  const account = await prisma.account.create({
    data: { email: `td-${randomUUID()}@example.com` },
    select: { id: true },
  });
  const handle = `td-${randomUUID().slice(0, 8)}`;
  const page = await prisma.page.create({
    data: { accountId: account.id, handle, skeleton: handle, displayName: 'Nadia Bakes' },
    select: { id: true },
  });
  const text = 'Berapa harga kek lapis?';
  const normalizedQuestion = 'berapa harga kek lapis';
  const question = await prisma.question.create({
    data: {
      pageId: page.id,
      text,
      normalizedQuestion,
      askCount: 5,
      answered: true,
      faqSlug: 'berapa-harga-kek-lapis',
    },
    select: { id: true },
  });
  await prisma.pinnedAnswer.create({
    data: { pageId: page.id, question: text, normalizedQuestion, answer: 'RM12 sekotak.' },
  });
  return { accountId: account.id, pageId: page.id, questionId: question.id, normalizedQuestion };
}

const stranger = async () => {
  const account = await prisma.account.create({
    data: { email: `sd-${randomUUID()}@example.com` },
    select: { id: true },
  });
  return account.id;
};

describe('setFaqSuppressed', () => {
  it('takes a published question off the public pages', async () => {
    const { accountId, questionId } = await seed();

    await setFaqSuppressed(prisma, accountId, questionId, true);

    const row = await prisma.question.findUniqueOrThrow({
      where: { id: questionId },
      select: { faqSuppressed: true, faqSlug: true, answered: true },
    });
    expect(row.faqSuppressed).toBe(true);
    // The slug survives, because a URL that has ranked must not be handed to a
    // different question later; and the answer survives, because the owner
    // said "not public", not "not true" -- chat still uses it.
    expect(row.faqSlug).toBe('berapa-harga-kek-lapis');
    expect(row.answered).toBe(true);
  });

  it('puts it back', async () => {
    const { accountId, questionId } = await seed();
    await setFaqSuppressed(prisma, accountId, questionId, true);

    await setFaqSuppressed(prisma, accountId, questionId, false);

    const row = await prisma.question.findUniqueOrThrow({
      where: { id: questionId },
      select: { faqSuppressed: true },
    });
    expect(row.faqSuppressed).toBe(false);
  });

  it('refuses a question belonging to another account', async () => {
    const { questionId } = await seed();
    const other = await stranger();

    await expect(setFaqSuppressed(prisma, other, questionId, true)).rejects.toMatchObject({
      statusCode: 404,
    });

    // And changed nothing. A rejection that still wrote would be the worst of
    // both: an error the caller sees and a mutation they did not authorise.
    const row = await prisma.question.findUniqueOrThrow({
      where: { id: questionId },
      select: { faqSuppressed: true },
    });
    expect(row.faqSuppressed).toBe(false);
  });
});

describe('deleteQuestion', () => {
  it('erases the question and the answer together', async () => {
    // Erasure, not suppression. Leaving the PinnedAnswer behind would keep the
    // same words reachable through chat under the same normalised key, which
    // is erasure that erases nothing.
    const { accountId, pageId, questionId, normalizedQuestion } = await seed();

    await deleteQuestion(prisma, accountId, questionId);

    expect(await prisma.question.findUnique({ where: { id: questionId } })).toBeNull();
    expect(
      await prisma.pinnedAnswer.findUnique({
        where: { pageId_normalizedQuestion: { pageId, normalizedQuestion } },
      }),
    ).toBeNull();
  });

  it('refuses a question belonging to another account, and deletes nothing', async () => {
    const { pageId, questionId, normalizedQuestion } = await seed();
    const other = await stranger();

    await expect(deleteQuestion(prisma, other, questionId)).rejects.toMatchObject({
      statusCode: 404,
    });

    expect(await prisma.question.findUnique({ where: { id: questionId } })).not.toBeNull();
    // The answer specifically: a scope check on the question that did not also
    // scope the answer delete would erase a stranger's answer while refusing
    // the request that asked for it.
    expect(
      await prisma.pinnedAnswer.findUnique({
        where: { pageId_normalizedQuestion: { pageId, normalizedQuestion } },
      }),
    ).not.toBeNull();
  });

  it('refuses an id that does not exist', async () => {
    const { accountId } = await seed();

    await expect(deleteQuestion(prisma, accountId, 'no-such-question')).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('leaves another question on the same page alone', async () => {
    const { accountId, pageId, questionId } = await seed();
    const keep = await prisma.question.create({
      data: { pageId, text: 'Ada halal?', normalizedQuestion: 'ada halal', askCount: 3 },
      select: { id: true },
    });

    await deleteQuestion(prisma, accountId, questionId);

    expect(await prisma.question.findUnique({ where: { id: keep.id } })).not.toBeNull();
  });
});
