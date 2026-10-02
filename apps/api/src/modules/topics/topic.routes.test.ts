import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { createSession, SESSION_COOKIE } from '../auth/session.service.js';

let app: FastifyInstance;
let nth = 0;
const from = () => `203.0.113.${(nth++ % 200) + 1}`;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

/** An owner with a topic of `wordings` wordings; the topic may start answered. */
async function anOwnerWithATopic(opts: { wordings?: number; answer?: string; conflictAnswer?: string; faqSlug?: string } = {}) {
  const slug = randomUUID().slice(0, 8);
  const account = await app.prisma.account.create({
    data: {
      email: `tr-${randomUUID()}@example.com`,
      pages: { create: { handle: `tr-${slug}`, skeleton: `tr-${slug}`, displayName: 'T' } },
    },
    select: { id: true, pages: { select: { id: true } } },
  });
  const pageId = account.pages[0]!.id;
  const topic = await app.prisma.topic.create({
    data: {
      pageId,
      title: `topic-${slug}`,
      askCount: 1,
      answer: opts.answer ?? null,
      answeredAt: opts.answer ? new Date() : null,
      conflictAnswer: opts.conflictAnswer ?? null,
      faqSlug: opts.faqSlug ?? null,
    },
  });
  const questionIds: string[] = [];
  for (let i = 0; i < (opts.wordings ?? 1); i++) {
    const q = await app.prisma.question.create({
      data: { pageId, topicId: topic.id, text: `wording ${i} ${slug}`, normalizedQuestion: `wording ${i} ${slug}` },
    });
    questionIds.push(q.id);
  }
  const { value } = await createSession(app.prisma, account.id);
  return { cookie: value, pageId, topicId: topic.id, questionIds };
}

const call = (cookie: string | null, method: 'POST' | 'DELETE' | 'PATCH', url: string, payload?: unknown) =>
  app.inject({
    method,
    url,
    remoteAddress: from(),
    ...(payload === undefined ? {} : { payload: payload as object }),
    ...(cookie ? { cookies: { [SESSION_COOKIE]: cookie } } : {}),
  });

const topicRow = (id: string) => app.prisma.topic.findUnique({ where: { id } });

describe('POST /topics/:id/answer', () => {
  it('answers the topic', async () => {
    const mine = await anOwnerWithATopic();
    const res = await call(mine.cookie, 'POST', `/topics/${mine.topicId}/answer`, { answer: 'RM95 sekilo.' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'answered' });
    expect((await topicRow(mine.topicId))?.answer).toBe('RM95 sekilo.');
  });

  it('is a 404 for another owner’s topic, which stays unanswered', async () => {
    const mine = await anOwnerWithATopic();
    const theirs = await anOwnerWithATopic();
    const res = await call(mine.cookie, 'POST', `/topics/${theirs.topicId}/answer`, { answer: 'mine now' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
    expect((await topicRow(theirs.topicId))?.answer).toBeNull();
  });

  it('refuses an unauthenticated caller', async () => {
    const mine = await anOwnerWithATopic();
    const res = await call(null, 'POST', `/topics/${mine.topicId}/answer`, { answer: 'hi' });
    expect(res.statusCode).toBe(401);
    expect((await topicRow(mine.topicId))?.answer).toBeNull();
  });

  it('is a 400 INVALID_ANSWER for a blank answer', async () => {
    const mine = await anOwnerWithATopic();
    const res = await call(mine.cookie, 'POST', `/topics/${mine.topicId}/answer`, { answer: '   ' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_ANSWER');
    expect((await topicRow(mine.topicId))?.answer).toBeNull();
  });
});

describe('DELETE /topics/:id/answer', () => {
  it('withdraws the answer', async () => {
    const mine = await anOwnerWithATopic({ answer: 'RM95.', conflictAnswer: 'RM90.' });
    const res = await call(mine.cookie, 'DELETE', `/topics/${mine.topicId}/answer`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'withdrawn' });
    const row = await topicRow(mine.topicId);
    expect(row?.answer).toBeNull();
    expect(row?.conflictAnswer).toBeNull();
  });

  it('is a 404 for another owner’s topic, which keeps its answer', async () => {
    const mine = await anOwnerWithATopic();
    const theirs = await anOwnerWithATopic({ answer: 'RM95.' });
    const res = await call(mine.cookie, 'DELETE', `/topics/${theirs.topicId}/answer`);
    expect(res.statusCode).toBe(404);
    expect((await topicRow(theirs.topicId))?.answer).toBe('RM95.');
  });
});

describe('POST /topics/:id/suppress', () => {
  it('suppresses and restores', async () => {
    const mine = await anOwnerWithATopic();
    const on = await call(mine.cookie, 'POST', `/topics/${mine.topicId}/suppress`, { suppressed: true });
    expect(on.statusCode).toBe(200);
    expect(on.json()).toEqual({ status: 'updated' });
    expect((await topicRow(mine.topicId))?.faqSuppressed).toBe(true);
    await call(mine.cookie, 'POST', `/topics/${mine.topicId}/suppress`, { suppressed: false });
    expect((await topicRow(mine.topicId))?.faqSuppressed).toBe(false);
  });

  it('is a 404 for another owner’s topic, which is not suppressed', async () => {
    const mine = await anOwnerWithATopic();
    const theirs = await anOwnerWithATopic();
    const res = await call(mine.cookie, 'POST', `/topics/${theirs.topicId}/suppress`, { suppressed: true });
    expect(res.statusCode).toBe(404);
    expect((await topicRow(theirs.topicId))?.faqSuppressed).toBe(false);
  });
});

describe('PATCH /topics/:id', () => {
  it('renames the topic', async () => {
    const mine = await anOwnerWithATopic();
    const res = await call(mine.cookie, 'PATCH', `/topics/${mine.topicId}`, { title: 'Cake prices' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'renamed' });
    const row = await topicRow(mine.topicId);
    expect(row?.title).toBe('Cake prices');
    expect(row?.titleSetByOwner).toBe(true);
  });

  it('is a 400 INVALID_TITLE for a blank title, which keeps the old one', async () => {
    const mine = await anOwnerWithATopic();
    const before = (await topicRow(mine.topicId))?.title;
    const res = await call(mine.cookie, 'PATCH', `/topics/${mine.topicId}`, { title: '  ' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_TITLE');
    expect((await topicRow(mine.topicId))?.title).toBe(before);
  });

  it('is a 404 for another owner’s topic, which keeps its title', async () => {
    const mine = await anOwnerWithATopic();
    const theirs = await anOwnerWithATopic();
    const before = (await topicRow(theirs.topicId))?.title;
    const res = await call(mine.cookie, 'PATCH', `/topics/${theirs.topicId}`, { title: 'Hijacked' });
    expect(res.statusCode).toBe(404);
    expect((await topicRow(theirs.topicId))?.title).toBe(before);
  });
});

describe('POST /topics/:id/merge', () => {
  it('merges the topic into another of the same owner', async () => {
    const mine = await anOwnerWithATopic();
    const other = await app.prisma.topic.create({ data: { pageId: mine.pageId, title: 'target' } });
    const res = await call(mine.cookie, 'POST', `/topics/${mine.topicId}/merge`, { intoTopicId: other.id, keepAnswer: 'into' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'merged' });
    expect(await topicRow(mine.topicId)).toBeNull();
    expect(await app.prisma.question.count({ where: { topicId: other.id } })).toBe(1);
  });

  it('is a 404 for another owner’s topic, on either side, and merges nothing', async () => {
    const mine = await anOwnerWithATopic();
    const theirs = await anOwnerWithATopic();
    const asSource = await call(mine.cookie, 'POST', `/topics/${theirs.topicId}/merge`, { intoTopicId: mine.topicId, keepAnswer: 'this' });
    expect(asSource.statusCode).toBe(404);
    const asTarget = await call(mine.cookie, 'POST', `/topics/${mine.topicId}/merge`, { intoTopicId: theirs.topicId, keepAnswer: 'this' });
    expect(asTarget.statusCode).toBe(404);
    expect(await topicRow(mine.topicId)).not.toBeNull();
    expect(await topicRow(theirs.topicId)).not.toBeNull();
  });
});

describe('POST /topics/:id/resolve', () => {
  it('resolves a conflict in favour of the held answer', async () => {
    const mine = await anOwnerWithATopic({ answer: 'current', conflictAnswer: 'held' });
    const res = await call(mine.cookie, 'POST', `/topics/${mine.topicId}/resolve`, { keep: 'conflict' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'resolved' });
    const row = await topicRow(mine.topicId);
    expect(row?.answer).toBe('held');
    expect(row?.conflictAnswer).toBeNull();
  });

  it('is a 409 NO_CONFLICT when there is nothing to resolve', async () => {
    const mine = await anOwnerWithATopic({ answer: 'current' });
    const res = await call(mine.cookie, 'POST', `/topics/${mine.topicId}/resolve`, { keep: 'answer' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('NO_CONFLICT');
  });

  it('is a 404 for another owner’s topic, which keeps its held answer', async () => {
    const mine = await anOwnerWithATopic();
    const theirs = await anOwnerWithATopic({ answer: 'current', conflictAnswer: 'held' });
    const res = await call(mine.cookie, 'POST', `/topics/${theirs.topicId}/resolve`, { keep: 'conflict' });
    expect(res.statusCode).toBe(404);
    expect((await topicRow(theirs.topicId))?.conflictAnswer).toBe('held');
  });
});

describe('DELETE /topics/:id', () => {
  it('deletes the topic and its wordings', async () => {
    const mine = await anOwnerWithATopic({ wordings: 2, answer: 'RM95.' });
    const res = await call(mine.cookie, 'DELETE', `/topics/${mine.topicId}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'deleted' });
    expect(await topicRow(mine.topicId)).toBeNull();
    expect(await app.prisma.question.count({ where: { pageId: mine.pageId } })).toBe(0);
  });

  it('is a 404 for another owner’s topic, which survives', async () => {
    const mine = await anOwnerWithATopic();
    const theirs = await anOwnerWithATopic();
    const res = await call(mine.cookie, 'DELETE', `/topics/${theirs.topicId}`);
    expect(res.statusCode).toBe(404);
    expect(await topicRow(theirs.topicId)).not.toBeNull();
    expect(await app.prisma.question.count({ where: { topicId: theirs.topicId } })).toBe(1);
  });
});

describe('POST /questions/:id/split', () => {
  it('splits a wording into a topic of its own and returns it', async () => {
    const mine = await anOwnerWithATopic({ wordings: 2 });
    const res = await call(mine.cookie, 'POST', `/questions/${mine.questionIds[1]}/split`);
    expect(res.statusCode).toBe(200);
    const { topicId } = res.json();
    expect(topicId).not.toBe(mine.topicId);
    const wording = await app.prisma.question.findUniqueOrThrow({ where: { id: mine.questionIds[1]! } });
    expect(wording.topicId).toBe(topicId);
    expect(wording.pinnedByOwner).toBe(true);
  });

  it('is a 400 ALREADY_ALONE for a lone wording', async () => {
    const mine = await anOwnerWithATopic({ wordings: 1 });
    const res = await call(mine.cookie, 'POST', `/questions/${mine.questionIds[0]}/split`);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('ALREADY_ALONE');
  });

  it('is a 404 for another owner’s wording, which stays where it was', async () => {
    const mine = await anOwnerWithATopic();
    const theirs = await anOwnerWithATopic({ wordings: 2 });
    const res = await call(mine.cookie, 'POST', `/questions/${theirs.questionIds[1]}/split`);
    expect(res.statusCode).toBe(404);
    const wording = await app.prisma.question.findUniqueOrThrow({ where: { id: theirs.questionIds[1]! } });
    expect(wording.topicId).toBe(theirs.topicId);
  });
});

describe('DELETE /questions/:id', () => {
  it('erases one wording', async () => {
    const mine = await anOwnerWithATopic({ wordings: 2 });
    const res = await call(mine.cookie, 'DELETE', `/questions/${mine.questionIds[0]}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'deleted' });
    expect(await app.prisma.question.findUnique({ where: { id: mine.questionIds[0]! } })).toBeNull();
    expect(await topicRow(mine.topicId)).not.toBeNull();
  });

  it('is a 404 for another owner’s wording, which survives', async () => {
    const mine = await anOwnerWithATopic();
    const theirs = await anOwnerWithATopic();
    const res = await call(mine.cookie, 'DELETE', `/questions/${theirs.questionIds[0]}`);
    expect(res.statusCode).toBe(404);
    expect(await app.prisma.question.count({ where: { id: theirs.questionIds[0]! } })).toBe(1);
  });
});
