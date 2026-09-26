import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { BIO_MAX, DISPLAY_NAME_MAX } from '@curios/core/bento';
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

async function anOwner() {
  const slug = randomUUID().slice(0, 8);
  const account = await app.prisma.account.create({
    data: {
      email: `look-${randomUUID()}@example.com`,
      emailVerifiedAt: new Date(),
      pages: { create: { handle: `ap-${slug}`, skeleton: `ap-${slug}`, displayName: 'Iman' } },
    },
    select: { id: true },
  });
  return (await createSession(app.prisma, account.id)).value;
}

/** No page claimed yet -- self-review addition: NO_PAGE was never exercised by the brief's tests. */
async function anOwnerWithNoPage() {
  const account = await app.prisma.account.create({
    data: { email: `look-nopage-${randomUUID()}@example.com`, emailVerifiedAt: new Date() },
    select: { id: true },
  });
  return (await createSession(app.prisma, account.id)).value;
}

const patch = (cookie: string, payload: object) =>
  app.inject({ method: 'PATCH', url: '/pages/appearance', remoteAddress: from(), cookies: { [SESSION_COOKIE]: cookie }, payload });

describe('PATCH /pages/appearance', () => {
  it('saves only what was sent', async () => {
    const cookie = await anOwner();
    await patch(cookie, { style: 'CONTRAST' });

    const res = await patch(cookie, { accentColor: '#6D3FB3', headingFont: 'FRAUNCES' });

    expect(res.statusCode).toBe(200);
    // Lower-cased on the way in, and the style from the first call kept.
    expect(res.json().appearance).toMatchObject({ style: 'CONTRAST', accentColor: '#6d3fb3', headingFont: 'FRAUNCES' });
  });

  it('refuses a colour that is not six-digit hex', async () => {
    const cookie = await anOwner();
    for (const accentColor of ['red', '#fff', '#0c7a62;background:url(x)']) {
      const res = await patch(cookie, { accentColor });
      expect(res.json().error.code).toBe('INVALID_APPEARANCE');
    }
  });

  it('trims the name and refuses an empty one', async () => {
    const cookie = await anOwner();
    expect((await patch(cookie, { displayName: '  Iman Muqri  ' })).json().appearance.displayName).toBe('Iman Muqri');
    expect((await patch(cookie, { displayName: '   ' })).json().error.code).toBe('INVALID_APPEARANCE');
  });

  // Not in the brief's table. Caught by mutation: dropping the DISPLAY_NAME_MAX
  // half of the guard (leaving only the empty-string check) left the whole
  // 4-test suite green, because none of the brief's own tests ever sent a name
  // longer than the limit.
  it('refuses a name over DISPLAY_NAME_MAX', async () => {
    const cookie = await anOwner();
    const res = await patch(cookie, { displayName: 'x'.repeat(DISPLAY_NAME_MAX + 1) });
    expect(res.json().error.code).toBe('INVALID_APPEARANCE');
  });

  it('clears the bio with an empty string, and refuses one over BIO_MAX', async () => {
    const cookie = await anOwner();
    await patch(cookie, { bio: 'Developer.' });

    expect((await patch(cookie, { bio: '   ' })).json().appearance.bio).toBeNull();
    expect((await patch(cookie, { bio: 'x'.repeat(BIO_MAX + 1) })).json().error.code).toBe('INVALID_APPEARANCE');
  });
});

describe('NO_PAGE', () => {
  // Not in the brief's table. Caught by mutation: removing the `throw new
  // NoPageError()` guard (updated.count !== 1) left the whole 4-test suite
  // green, because anOwner() always claims a page first, so nothing ever
  // exercised this path -- the same gap link.routes.test.ts calls out for its
  // own routes.
  it('answers 404 for an owner who has not claimed a page yet', async () => {
    const cookie = await anOwnerWithNoPage();
    const res = await patch(cookie, { style: 'CONTRAST' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NO_PAGE');
  });
});
