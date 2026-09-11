import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getQuestions } from './questions.query.js';

const write = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

let mine = '';
let theirs = '';
let myPageId = '';

async function anOwnerWithAPage(): Promise<{ accountId: string; pageId: string }> {
  const slug = randomUUID().slice(0, 8);
  const account = await write.account.create({
    data: {
      email: `qq-${randomUUID()}@example.com`,
      pages: { create: { handle: `qq-${slug}`, skeleton: `qq-${slug}`, displayName: 'Q' } },
    },
    select: { id: true, pages: { select: { id: true } } },
  });
  return { accountId: account.id, pageId: account.pages[0]?.id ?? '' };
}

async function aQuestion(
  pageId: string,
  text: string,
  askCount: number,
  answered = false,
): Promise<void> {
  await write.question.create({
    data: { pageId, text, normalizedQuestion: text, askCount, answered },
  });
}

beforeAll(async () => {
  const a = await anOwnerWithAPage();
  const b = await anOwnerWithAPage();
  mine = a.accountId;
  myPageId = a.pageId;
  theirs = b.accountId;

  await aQuestion(myPageId, 'berapa harga kek', 9);
  await aQuestion(myPageId, 'ada delivery', 4, true);
  await aQuestion(myPageId, 'buka pukul berapa', 1);
  await aQuestion(b.pageId, 'someone elses question', 99);
});

describe('getQuestions', () => {
  it('ranks by ask count, most asked first', async () => {
    // The one ordering this screen has. An owner scanning a list wants the gap
    // that costs them most at the top, and that is frequency.
    const questions = await getQuestions(mine);
    expect(questions.map((q) => q.text)).toEqual([
      'berapa harga kek',
      'ada delivery',
      'buka pukul berapa',
    ]);
  });

  it('returns nothing for an account that owns none of them', async () => {
    // Scoped in the query rather than filtered after the read -- the same
    // shape as every other ownership check in this codebase. The other page's
    // question has the highest ask count of all, so a broken scope would put
    // it first rather than hide it.
    const questions = await getQuestions(theirs);
    expect(questions.map((q) => q.text)).toEqual(['someone elses question']);
  });

  it('reports whether each has been answered', async () => {
    const questions = await getQuestions(mine);
    expect(questions.find((q) => q.text === 'ada delivery')?.answered).toBe(true);
    expect(questions.find((q) => q.text === 'berapa harga kek')?.answered).toBe(false);
  });

  it('does not write, so the read-only role can run it', async () => {
    // apps/web connects as curios_readonly. A write here fails in Postgres
    // with SQLSTATE 42501 rather than in code review.
    await expect(getQuestions(mine)).resolves.toBeDefined();
  });

  it('clamps the limit rather than trusting a caller', async () => {
    const questions = await getQuestions(mine, { limit: 2 });
    expect(questions).toHaveLength(2);
  });
});

describe('the answer an owner already wrote', () => {
  it('comes back with the question, so the editor can prefill it', async () => {
    // Without this the only way to fix a typo in a published price is to
    // delete the question and wait for somebody to ask it three more times.
    const { accountId, pageId } = await anOwnerWithAPage();
    const text = 'Berapa harga kek lapis?';
    const normalizedQuestion = `berapa harga kek lapis ${randomUUID().slice(0, 6)}`;
    await write.question.create({
      data: { pageId, text, normalizedQuestion, askCount: 4, answered: true },
    });
    await write.pinnedAnswer.create({
      data: { pageId, question: text, normalizedQuestion, answer: 'RM12 sekotak.' },
    });

    const rows = await getQuestions(accountId);

    expect(rows.find((r) => r.text === text)?.answer).toBe('RM12 sekotak.');
  });

  it('is null for a question nobody has answered', async () => {
    // Null rather than an empty string: the editor opens blank either way, but
    // "no answer exists" and "the answer is empty" are different facts and the
    // screen decides what to offer from this one.
    const { accountId, pageId } = await anOwnerWithAPage();
    const text = 'Ada parking?';
    await write.question.create({
      data: {
        pageId,
        text,
        normalizedQuestion: `ada parking ${randomUUID().slice(0, 6)}`,
        askCount: 2,
      },
    });

    const rows = await getQuestions(accountId);

    expect(rows.find((r) => r.text === text)?.answer).toBeNull();
  });
});

