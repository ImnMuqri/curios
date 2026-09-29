import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { createSession, SESSION_COOKIE } from '../auth/session.service.js';

let app: FastifyInstance;
let nth = 0;
const from = () => `203.0.113.${(nth++ % 200) + 1}`;

beforeAll(async () => {
  app = await buildApp({ facts: { embedder: null } });
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

async function anOwnerWithASource(status: 'SUCCEEDED' | 'RUNNING' = 'SUCCEEDED') {
  const slug = randomUUID().slice(0, 8);
  const account = await app.prisma.account.create({
    data: {
      email: `srcr-${randomUUID()}@example.com`,
      pages: { create: { handle: `sr-${slug}`, skeleton: `sr-${slug}`, displayName: 'S' } },
    },
    select: { id: true, pages: { select: { id: true } } },
  });
  const pageId = account.pages[0]?.id ?? '';
  const source = await app.prisma.ingestion.create({ data: { pageId, sourceUrl: 'https://s.example/', status } });
  await app.prisma.fact.create({
    data: { pageId, ingestionId: source.id, category: 'MISC', claim: `c-${slug}`, normalizedClaim: `c-${slug}`, confidence: 1, verified: true },
  });
  const { value } = await createSession(app.prisma, account.id);
  return { cookie: value, pageId, sourceId: source.id };
}

/** Not in the brief's table -- see self-review note in the task report. */
async function anOwnerWithAPastedSource() {
  const slug = randomUUID().slice(0, 8);
  const account = await app.prisma.account.create({
    data: {
      email: `srcr-${randomUUID()}@example.com`,
      pages: { create: { handle: `sp-${slug}`, skeleton: `sp-${slug}`, displayName: 'S' } },
    },
    select: { id: true, pages: { select: { id: true } } },
  });
  const pageId = account.pages[0]?.id ?? '';
  const source = await app.prisma.ingestion.create({ data: { pageId, pastedText: 'About us.', status: 'SUCCEEDED' } });
  const { value } = await createSession(app.prisma, account.id);
  return { cookie: value, sourceId: source.id };
}

const call = (cookie: string | null, method: 'POST' | 'DELETE', url: string) =>
  app.inject({ method, url, remoteAddress: from(), ...(cookie ? { cookies: { [SESSION_COOKIE]: cookie } } : {}) });

describe('DELETE /sources/:id', () => {
  it('removes the source and says how many facts went', async () => {
    const mine = await anOwnerWithASource();
    const res = await call(mine.cookie, 'DELETE', `/sources/${mine.sourceId}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ removedFacts: 1 });
  });

  it('is a 409 with its own code while the source is being read', async () => {
    const mine = await anOwnerWithASource('RUNNING');
    const res = await call(mine.cookie, 'DELETE', `/sources/${mine.sourceId}`);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('SOURCE_BUSY');
  });

  it('is a 404 for another owner’s source, which survives', async () => {
    const mine = await anOwnerWithASource();
    const theirs = await anOwnerWithASource();
    const res = await call(mine.cookie, 'DELETE', `/sources/${theirs.sourceId}`);
    expect(res.statusCode).toBe(404);
    expect(await app.prisma.ingestion.count({ where: { id: theirs.sourceId } })).toBe(1);
  });

  it('refuses an unauthenticated caller', async () => {
    const mine = await anOwnerWithASource();
    expect((await call(null, 'DELETE', `/sources/${mine.sourceId}`)).statusCode).toBe(401);
  });
});

describe('POST /sources/:id/recheck', () => {
  it('queues the source again', async () => {
    const mine = await anOwnerWithASource();
    const res = await call(mine.cookie, 'POST', `/sources/${mine.sourceId}/recheck`);
    expect(res.statusCode).toBe(202);
    expect((await app.prisma.ingestion.findUniqueOrThrow({ where: { id: mine.sourceId } })).status).toBe('QUEUED');
  });

  it('is a 404 for another owner’s source, which is not queued', async () => {
    const mine = await anOwnerWithASource();
    const theirs = await anOwnerWithASource();
    const res = await call(mine.cookie, 'POST', `/sources/${theirs.sourceId}/recheck`);
    expect(res.statusCode).toBe(404);
    expect((await app.prisma.ingestion.findUniqueOrThrow({ where: { id: theirs.sourceId } })).status).toBe('SUCCEEDED');
  });

  it('refuses an unauthenticated caller', async () => {
    const mine = await anOwnerWithASource();
    expect((await call(null, 'POST', `/sources/${mine.sourceId}/recheck`)).statusCode).toBe(401);
  });

  // Not in the brief's table. Only source.service.test.ts checked these two
  // rejections by class (`instanceof`); nothing proved the codes actually
  // survive the trip through errorsPlugin's DOMAIN_ERROR_CODES allow-list
  // over HTTP. Caught by mutation -- dropping SOURCE_NOT_RECHECKABLE from
  // that allow-list left the whole `src/modules/sources` suite green.
  it('is a 409 with its own code while the source is being read', async () => {
    const mine = await anOwnerWithASource('RUNNING');
    const res = await call(mine.cookie, 'POST', `/sources/${mine.sourceId}/recheck`);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('SOURCE_BUSY');
  });

  it('is a 400 with its own code for pasted text, which stays as it was', async () => {
    const mine = await anOwnerWithAPastedSource();
    const res = await call(mine.cookie, 'POST', `/sources/${mine.sourceId}/recheck`);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('SOURCE_NOT_RECHECKABLE');
    expect((await app.prisma.ingestion.findUniqueOrThrow({ where: { id: mine.sourceId } })).status).toBe('SUCCEEDED');
  });
});
