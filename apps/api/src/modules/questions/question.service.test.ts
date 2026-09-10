import { beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { answerQuestion } from './question.service.js';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

let accountId = '';
let strangerAccountId = '';
let questionId = '';

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "Account" CASCADE');

  const account = await prisma.account.create({
    data: {
      email: 'n@example.com',
      pages: {
        create: {
          handle: 'nadia',
          skeleton: 'nadia',
          displayName: 'Nadia Bakes',
          questions: {
            create: {
              text: 'Berapa harga kek?',
              normalizedQuestion: 'berapa harga kek',
              askCount: 9,
            },
          },
        },
      },
    },
    include: { pages: { include: { questions: true } } },
  });
  accountId = account.id;
  questionId = account.pages[0]?.questions[0]?.id ?? '';

  const stranger = await prisma.account.create({ data: { email: 'stranger@example.com' } });
  strangerAccountId = stranger.id;
});

describe('answerQuestion', () => {
  it('creates a pinned answer on the same key the chat path looks up', async () => {
    await answerQuestion(prisma, accountId, questionId, 'RM95 sekilo.');

    const pinned = await prisma.pinnedAnswer.findFirstOrThrow({});
    expect(pinned.answer).toBe('RM95 sekilo.');
    // The same normalised key, which is the whole reason this works at all.
    expect(pinned.normalizedQuestion).toBe('berapa harga kek');
    // The verbatim phrasing travels too, so a knowledge screen can later show
    // what was asked rather than the stripped-down key.
    expect(pinned.question).toBe('Berapa harga kek?');
  });

  it('marks the question answered', async () => {
    await answerQuestion(prisma, accountId, questionId, 'RM95 sekilo.');

    const question = await prisma.question.findUniqueOrThrow({ where: { id: questionId } });
    expect(question.answered).toBe(true);
  });

  it('replaces an answer rather than failing on the second edit', async () => {
    // PinnedAnswer is unique on (pageId, normalizedQuestion). An owner fixing a
    // typo must not hit a constraint error.
    await answerQuestion(prisma, accountId, questionId, 'RM95.');
    await answerQuestion(prisma, accountId, questionId, 'RM95 sekilo, minimum dua.');

    const pinned = await prisma.pinnedAnswer.findFirstOrThrow({});
    expect(pinned.answer).toBe('RM95 sekilo, minimum dua.');
    expect(await prisma.pinnedAnswer.count()).toBe(1);
  });

  it('refuses a question belonging to someone else', async () => {
    // 404, not 403: a 403 confirms the id exists, which is itself a leak --
    // the same reasoning as PageNotYoursError in the ingest service.
    await expect(
      answerQuestion(prisma, strangerAccountId, questionId, 'mine now'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    // Nothing written. A refused write that still left a pinned answer would
    // be worse than a permissive one, because it would be invisible.
    expect(await prisma.pinnedAnswer.count()).toBe(0);
    expect((await prisma.question.findUniqueOrThrow({ where: { id: questionId } })).answered).toBe(
      false,
    );
  });

  it('refuses a question that does not exist', async () => {
    await expect(answerQuestion(prisma, accountId, 'nope', 'hello')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
