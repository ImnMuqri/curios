import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { mailQuestionAsked } from './question-mail.js';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
});
afterAll(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
  await prisma.$disconnect();
});

let n = 0;
async function aTopic(opts: { notify?: boolean; askCount?: number; answer?: string; asks?: { answered: boolean | null; reply: string | null }[] } = {}) {
  n += 1;
  const account = await prisma.account.create({
    data: {
      email: `qm${n}@example.com`,
      pages: { create: { handle: `qm${n}`, skeleton: `qm${n}`, displayName: 'Kek Lina', mode: 'BUSINESS', notifyQuestions: opts.notify ?? true } },
    },
    include: { pages: true },
  });
  const pageId = account.pages[0]!.id;
  const topic = await prisma.topic.create({ data: { pageId, title: 'Do you deliver to Klang?', askCount: opts.askCount ?? 3, answer: opts.answer ?? null } });
  const question = await prisma.question.create({
    data: { pageId, topicId: topic.id, text: topic.title, normalizedQuestion: `q${n}`, askCount: opts.askCount ?? 3 },
  });
  for (const [i, ask] of (opts.asks ?? []).entries()) {
    await prisma.questionAsk.create({ data: { questionId: question.id, askedAt: new Date(2026, 10, 1, 10, i), ...ask } });
  }
  return { topicId: topic.id, email: account.email };
}

const queue = () => ({ add: vi.fn(async (_name: string, _data: { to: string; subject: string; text: string; audience?: string }, _opts?: unknown) => ({})) });
const run = (mailQueue: ReturnType<typeof queue>, topicId: string, hint?: boolean) =>
  mailQuestionAsked({ prisma, mailQueue, appUrl: 'https://curios.example' }, topicId, hint);
const mailedAt = async (topicId: string) => (await prisma.topic.findUniqueOrThrow({ where: { id: topicId } })).askedMailedAt;

describe('mailQuestionAsked', () => {
  it('sends nothing for 2 asks, one email for 3, and none again for the 4th', async () => {
    const { topicId, email } = await aTopic({ askCount: 2 });
    const mailQueue = queue();

    await run(mailQueue, topicId);
    expect(mailQueue.add).not.toHaveBeenCalled();

    await prisma.topic.update({ where: { id: topicId }, data: { askCount: 3 } });
    await run(mailQueue, topicId);
    expect(mailQueue.add).toHaveBeenCalledTimes(1);
    const mail = mailQueue.add.mock.calls[0]?.[1];
    expect(mail).toMatchObject({ to: email, audience: 'owner', subject: 'People keep asking: “Do you deliver to Klang?”' });
    expect(mail?.text).toContain(`/app/questions?topic=${topicId}`);

    await prisma.topic.update({ where: { id: topicId }, data: { askCount: 4 } });
    await run(mailQueue, topicId);
    expect(mailQueue.add).toHaveBeenCalledTimes(1);
  });

  it('sends one email when asks race', async () => {
    const { topicId } = await aTopic();
    const mailQueue = queue();

    await Promise.all([1, 2, 3, 4, 5].map(() => run(mailQueue, topicId)));

    expect(mailQueue.add).toHaveBeenCalledTimes(1);
  });

  it('sends nothing, claims nothing and reads nothing when the switch is off', async () => {
    const { topicId } = await aTopic({ notify: false });
    const mailQueue = queue();
    // A client that fails on any use: with the hint off, nothing is read at all.
    const untouchable = new Proxy({}, { get: () => { throw new Error('read'); } }) as unknown as PrismaClient;
    const warn = vi.fn();
    await mailQuestionAsked({ prisma: untouchable, mailQueue, appUrl: 'https://curios.example', log: { warn } }, topicId, false);
    expect(warn).not.toHaveBeenCalled();
    await run(mailQueue, topicId);
    expect(mailQueue.add).not.toHaveBeenCalled();
    expect(await mailedAt(topicId)).toBeNull();
  });

  it('sends nothing for a topic the owner answered', async () => {
    const { topicId } = await aTopic({ answer: 'Yes, RM8.' });
    const mailQueue = queue();
    await run(mailQueue, topicId);
    expect(mailQueue.add).not.toHaveBeenCalled();
  });

  it('sends nothing for a topic the chat answers, by the rule of Questions’ "Needs your answer"', async () => {
    const { topicId } = await aTopic({ asks: [{ answered: false, reply: 'Not sure.' }, { answered: true, reply: 'Yes, we do.' }] });
    const mailQueue = queue();
    await run(mailQueue, topicId);
    expect(mailQueue.add).not.toHaveBeenCalled();
    expect(await mailedAt(topicId)).toBeNull();
  });

  it('still sends when the chat’s latest reply was a shrug', async () => {
    const { topicId } = await aTopic({ asks: [{ answered: true, reply: 'Yes.' }, { answered: false, reply: 'Not sure.' }] });
    const mailQueue = queue();
    await run(mailQueue, topicId);
    expect(mailQueue.add).toHaveBeenCalledTimes(1);
  });

  it('does nothing for a topic that no longer exists', async () => {
    const { topicId } = await aTopic();
    await prisma.topic.delete({ where: { id: topicId } });
    const mailQueue = queue();
    await run(mailQueue, topicId);
    expect(mailQueue.add).not.toHaveBeenCalled();
  });

  it('never throws when the queue is down', async () => {
    const { topicId } = await aTopic();
    const mailQueue = { add: vi.fn(async () => Promise.reject(new Error('redis down'))) };
    await expect(mailQuestionAsked({ prisma, mailQueue, appUrl: 'https://curios.example' }, topicId)).resolves.toBeUndefined();
  });
});
