import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { createSession, SESSION_COOKIE } from '../auth/session.service.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

/**
 * `setFaqSuppressed` and `deleteQuestion` already have direct-call coverage in
 * question.takedown.test.ts. What that file cannot prove is that the two
 * routes are registered at all, and that they sit behind a session.
 *
 * That matters more here than usual. These are the two controls standing
 * between a customer's own words and a public, indexed page: if either were
 * registered into an anonymous scope, every direct-call test would still pass
 * while a stranger could unpublish -- or erase -- any owner's question by id.
 * A route that answers 401 is registered and guarded; an unregistered route
 * answers 404, which is why both cases are asserted rather than just the
 * happy path.
 */
async function anOwnerWithAPublishedQuestion() {
  const slug = randomUUID().slice(0, 8);
  const account = await app.prisma.account.create({
    data: {
      email: `q-route-${randomUUID()}@example.com`,
      pages: { create: { handle: `qr-${slug}`, skeleton: `qr-${slug}`, displayName: 'QR' } },
    },
    select: { id: true, pages: { select: { id: true } } },
  });
  const pageId = account.pages[0]!.id;
  const text = 'Berapa harga kek?';
  const normalizedQuestion = `berapa harga kek ${slug}`;
  const question = await app.prisma.question.create({
    data: { pageId, text, normalizedQuestion, askCount: 5, answered: true, faqSlug: `qs-${slug}` },
    select: { id: true },
  });
  await app.prisma.pinnedAnswer.create({
    data: { pageId, question: text, normalizedQuestion, answer: 'RM12 sekotak.' },
  });
  const session = await createSession(app.prisma, account.id);
  return { questionId: question.id, cookie: `${SESSION_COOKIE}=${session.value}` };
}

describe('POST /questions/:id/suppress', () => {
  it('refuses a request with no session', async () => {
    const { questionId } = await anOwnerWithAPublishedQuestion();

    const res = await app.inject({
      method: 'POST',
      url: `/questions/${questionId}/suppress`,
      headers: { 'content-type': 'application/json' },
      payload: { suppressed: true },
    });

    // 401, not 404: 404 would mean the route is not registered at all, and
    // this assertion exists to tell those two apart.
    expect(res.statusCode).toBe(401);
  });

  it('suppresses for the owner, and the row shows it', async () => {
    const { questionId, cookie } = await anOwnerWithAPublishedQuestion();

    const res = await app.inject({
      method: 'POST',
      url: `/questions/${questionId}/suppress`,
      headers: { 'content-type': 'application/json', cookie },
      payload: { suppressed: true },
    });

    expect(res.statusCode).toBe(200);
    const row = await app.prisma.question.findUniqueOrThrow({
      where: { id: questionId },
      select: { faqSuppressed: true },
    });
    expect(row.faqSuppressed).toBe(true);
  });
});

describe('DELETE /questions/:id', () => {
  it('refuses a request with no session', async () => {
    const { questionId } = await anOwnerWithAPublishedQuestion();

    const res = await app.inject({
      method: 'DELETE',
      url: `/questions/${questionId}`,
      // The content-type and body apiFetch actually sends on a DELETE. A route
      // that only accepts an empty body breaks in the browser while passing a
      // test that omits them -- this seam has broken here before.
      headers: { 'content-type': 'application/json' },
      payload: {},
    });

    expect(res.statusCode).toBe(401);
    expect(await app.prisma.question.findUnique({ where: { id: questionId } })).not.toBeNull();
  });

  it('erases the question for its owner', async () => {
    const { questionId, cookie } = await anOwnerWithAPublishedQuestion();

    const res = await app.inject({
      method: 'DELETE',
      url: `/questions/${questionId}`,
      headers: { 'content-type': 'application/json', cookie },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(await app.prisma.question.findUnique({ where: { id: questionId } })).toBeNull();
  });
});
