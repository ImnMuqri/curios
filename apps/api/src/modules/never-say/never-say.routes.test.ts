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

async function anOwner() {
  const slug = randomUUID().slice(0, 8);
  const account = await app.prisma.account.create({
    data: {
      email: `ns-${randomUUID()}@example.com`,
      pages: { create: { handle: `ns-${slug}`, skeleton: `ns-${slug}`, displayName: 'N' } },
    },
    select: { id: true },
  });
  const { value } = await createSession(app.prisma, account.id);
  return { cookie: value };
}

const call = (cookie: string | null, method: 'POST' | 'DELETE', url: string, payload?: unknown) =>
  app.inject({
    method,
    url,
    remoteAddress: from(),
    ...(cookie ? { cookies: { [SESSION_COOKIE]: cookie } } : {}),
    ...(payload ? { payload } : {}),
  });

describe('POST /never-say', () => {
  it('adds an entry', async () => {
    const mine = await anOwner();
    const res = await call(mine.cookie, 'POST', '/never-say', { phrase: 'halal certified' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ phrase: 'halal certified' });
  });

  it('says why an entry was refused', async () => {
    const mine = await anOwner();
    const res = await call(mine.cookie, 'POST', '/never-say', { phrase: 'a\nb' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_NEVER_SAY');
  });

  it('refuses an unauthenticated caller', async () => {
    const res = await call(null, 'POST', '/never-say', { phrase: 'x' });
    expect(res.statusCode).toBe(401);
  });
});

describe('DELETE /never-say/:id', () => {
  it("is a 404 for another owner's entry", async () => {
    const mine = await anOwner();
    const theirs = await anOwner();
    const { id } = (await call(theirs.cookie, 'POST', '/never-say', { phrase: 'theirs' })).json<{ id: string }>();
    expect((await call(mine.cookie, 'DELETE', `/never-say/${id}`)).statusCode).toBe(404);
    expect((await call(theirs.cookie, 'DELETE', `/never-say/${id}`)).statusCode).toBe(200);
  });
});
