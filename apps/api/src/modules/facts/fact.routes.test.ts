import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { createSession, SESSION_COOKIE } from '../auth/session.service.js';

let app: FastifyInstance;

let nth = 0;
/** A fresh source address per request, so the limiter never sees a flood. */
const from = () => `203.0.113.${(nth++ % 200) + 1}`;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

async function anOwnerWithAFact(claim = 'kuih lapis is rm12') {
  const slug = randomUUID().slice(0, 8);
  const account = await app.prisma.account.create({
    data: {
      email: `fact-${randomUUID()}@example.com`,
      pages: { create: { handle: `f-${slug}`, skeleton: `f-${slug}`, displayName: 'F' } },
    },
    select: { id: true, pages: { select: { id: true } } },
  });
  const pageId = account.pages[0]?.id ?? '';
  const fact = await app.prisma.fact.create({
    data: { pageId, category: 'PRICE', claim, normalizedClaim: claim, confidence: 0.9 },
    select: { id: true },
  });
  const { value } = await createSession(app.prisma, account.id);
  return { cookie: value, pageId, factId: fact.id };
}

describe('POST /facts/:id/verify', () => {
  it('verifies one fact', async () => {
    const mine = await anOwnerWithAFact();

    const res = await app.inject({
      method: 'POST',
      url: `/facts/${mine.factId}/verify`,
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: mine.cookie },
    });

    expect(res.statusCode).toBe(200);
    const fact = await app.prisma.fact.findUnique({ where: { id: mine.factId } });
    expect(fact?.verified).toBe(true);
  });

  it('refuses another owner fact, and leaves it unverified', async () => {
    const mine = await anOwnerWithAFact();
    const theirs = await anOwnerWithAFact('their price is rm40');

    const res = await app.inject({
      method: 'POST',
      url: `/facts/${theirs.factId}/verify`,
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: mine.cookie },
    });

    // Verifying is what puts a claim in front of a customer. Doing it to
    // someone else's page is the planted-price attack in one request.
    expect(res.statusCode).toBe(404);
    const fact = await app.prisma.fact.findUnique({ where: { id: theirs.factId } });
    expect(fact?.verified).toBe(false);
  });

  it('refuses an unauthenticated caller', async () => {
    const mine = await anOwnerWithAFact();

    const res = await app.inject({
      method: 'POST',
      url: `/facts/${mine.factId}/verify`,
      remoteAddress: from(),
    });

    expect(res.statusCode).toBe(401);
  });
});

describe('PATCH /facts/:id', () => {
  it('re-normalises an edited claim', async () => {
    const mine = await anOwnerWithAFact();

    const res = await app.inject({
      method: 'PATCH',
      url: `/facts/${mine.factId}`,
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: mine.cookie },
      payload: { claim: 'Kuih Lapis is RM14!' },
    });

    expect(res.statusCode).toBe(200);
    const fact = await app.prisma.fact.findUnique({ where: { id: mine.factId } });
    // The dedupe key must never drift from the text it keys.
    expect(fact?.claim).toBe('Kuih Lapis is RM14!');
    expect(fact?.normalizedClaim).toBe('kuih lapis is rm14');
  });

  it('reports an edit that collides with another fact on the same page', async () => {
    const mine = await anOwnerWithAFact('first claim here');
    await app.prisma.fact.create({
      data: {
        pageId: mine.pageId,
        category: 'PRICE',
        claim: 'second claim here',
        normalizedClaim: 'second claim here',
        confidence: 0.9,
      },
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/facts/${mine.factId}`,
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: mine.cookie },
      payload: { claim: 'Second claim here' },
    });

    // A P2002 on [pageId, normalizedClaim], surfaced as something an owner can
    // act on rather than a 500.
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('FACT_DUPLICATE');
  });
});

describe('POST /facts/:id/reject', () => {
  it('soft-deletes the fact and stops it being public', async () => {
    const mine = await anOwnerWithAFact();
    await app.inject({
      method: 'POST',
      url: `/facts/${mine.factId}/verify`,
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: mine.cookie },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/facts/${mine.factId}/reject`,
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: mine.cookie },
    });

    expect(res.statusCode).toBe(200);
    const fact = await app.prisma.fact.findUnique({ where: { id: mine.factId } });
    expect(fact?.rejectedAt).not.toBeNull();
    // Both public read paths filter on `verified`, not on `rejectedAt`. If
    // rejecting a previously accepted fact left verified true, the rejected
    // claim would still be answering customers.
    expect(fact?.verified).toBe(false);
  });

  it('keeps the row, so the next crawl does not re-ask', async () => {
    const mine = await anOwnerWithAFact();

    await app.inject({
      method: 'POST',
      url: `/facts/${mine.factId}/reject`,
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: mine.cookie },
    });

    // Extraction writes with skipDuplicates against
    // @@unique([pageId, normalizedClaim]). A hard delete would let the same
    // dismissed claim reappear in the queue on the next crawl.
    expect(await app.prisma.fact.findUnique({ where: { id: mine.factId } })).not.toBeNull();
  });
});

describe('the one hard rule', () => {
  it('exposes no route that can verify more than one fact', () => {
    const routes = app.printRoutes({ commonPrefix: false });

    // A negative requirement, so it needs a test that fails when someone adds
    // the thing rather than one that passes because they have not yet. Nothing
    // sets verified: true except an explicit human action on one specific
    // fact; a bulk-accept control is precisely how an unreviewed price ships,
    // and that is the single failure this product cannot recover from.
    const mutating = routes
      .split('\n')
      .filter((line) => line.includes('/facts') && /POST|PATCH|PUT|DELETE/.test(line));

    expect(mutating.length).toBeGreaterThan(0);
    for (const line of mutating) {
      expect(line).toMatch(/:id/);
    }
  });
});
