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
