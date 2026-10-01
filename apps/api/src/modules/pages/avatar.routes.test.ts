import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { createSession, SESSION_COOKIE } from '../auth/session.service.js';
import type { AvatarStore } from './storage.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString('base64');
const store: AvatarStore & { put: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> } = {
  put: vi.fn(async () => undefined),
  remove: vi.fn(async () => undefined),
};

let app: FastifyInstance;
let off: FastifyInstance;
let nth = 0;
const from = () => `203.0.113.${(nth++ % 200) + 1}`;

beforeAll(async () => {
  app = await buildApp({ pages: { store } });
  off = await buildApp({ pages: { store: null } });
  await Promise.all([app.ready(), off.ready()]);
});
afterAll(async () => {
  await Promise.all([app.close(), off.close()]);
});

async function anOwner(on = app) {
  const slug = randomUUID().slice(0, 8);
  const account = await on.prisma.account.create({
    data: { email: `pic-${randomUUID()}@example.com`, emailVerifiedAt: new Date(), pages: { create: { handle: `pc-${slug}`, skeleton: `pc-${slug}`, displayName: 'Iman' } } },
    select: { id: true },
  });
  return { accountId: account.id, cookie: (await createSession(on.prisma, account.id)).value };
}

/** An account that has not claimed a handle yet -- no page to attach a picture to. */
async function anAccountWithoutPage(on = app) {
  const account = await on.prisma.account.create({
    data: { email: `pic-nopage-${randomUUID()}@example.com`, emailVerifiedAt: new Date() },
    select: { id: true },
  });
  return (await createSession(on.prisma, account.id)).value;
}

const upload = (on: FastifyInstance, cookie: string, payload: object) =>
  on.inject({ method: 'POST', url: '/pages/avatar', remoteAddress: from(), cookies: { [SESSION_COOKIE]: cookie }, payload });

const keyOf = async (accountId: string) =>
  (await app.prisma.page.findUniqueOrThrow({ where: { accountId }, select: { avatarKey: true } })).avatarKey;

describe('POST /pages/avatar', () => {
  it('refuses an unauthenticated caller', async () => {
    const res = await app.inject({ method: 'POST', url: '/pages/avatar', remoteAddress: from(), payload: { contentType: 'image/png', data: PNG } });
    expect(res.statusCode).toBe(401);
  });

  it('answers NO_PAGE for an account with no page yet', async () => {
    const res = await upload(app, await anAccountWithoutPage(), { contentType: 'image/png', data: PNG });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NO_PAGE');
  });

  it('stores the picture under a fresh key and records it', async () => {
    const owner = await anOwner();
    const res = await upload(app, owner.cookie, { contentType: 'image/png', data: PNG });

    expect(res.statusCode).toBe(200);
    const key = await keyOf(owner.accountId);
    expect(key).toMatch(/^avatars\/[^/]+\/[0-9a-f-]+\.png$/);
    expect(store.put).toHaveBeenLastCalledWith(key, expect.any(Buffer), 'image/png');
  });

  it('removes the old picture after the new one is recorded', async () => {
    const owner = await anOwner();
    await upload(app, owner.cookie, { contentType: 'image/png', data: PNG });
    const first = await keyOf(owner.accountId);

    // The two assertions below would still pass even if the old object were
    // removed BEFORE the new key was recorded -- both only look once the
    // whole request has settled. This reads the page from inside the
    // handler, at the exact moment `remove` is invoked, which is where order
    // actually shows up.
    let avatarKeyWhileRemoving: string | null = null;
    store.remove.mockImplementationOnce(async () => {
      avatarKeyWhileRemoving = await keyOf(owner.accountId);
    });

    await upload(app, owner.cookie, { contentType: 'image/png', data: PNG });

    expect(await keyOf(owner.accountId)).not.toBe(first);
    expect(store.remove).toHaveBeenLastCalledWith(first);
    // If the old object were removed first, the page would still show `first`
    // at this point -- the DB write must already have landed.
    expect(avatarKeyWhileRemoving).not.toBe(first);
  });

  // Review Focus 4, end to end: the old picture stays.
  it('refuses a file that is not what it claims, and keeps the old picture', async () => {
    const owner = await anOwner();
    await upload(app, owner.cookie, { contentType: 'image/png', data: PNG });
    const kept = await keyOf(owner.accountId);

    const res = await upload(app, owner.cookie, { contentType: 'image/png', data: Buffer.from('not an image').toString('base64') });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_IMAGE');
    expect(await keyOf(owner.accountId)).toBe(kept);
  });

  it('answers STORAGE_NOT_CONFIGURED when uploads are switched off', async () => {
    const owner = await anOwner(off);
    const res = await upload(off, owner.cookie, { contentType: 'image/png', data: PNG });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('STORAGE_NOT_CONFIGURED');
  });

  it('keeps the new picture even if removing the old one fails', async () => {
    const owner = await anOwner();
    await upload(app, owner.cookie, { contentType: 'image/png', data: PNG });
    store.remove.mockRejectedValueOnce(new Error('storage blip'));

    const res = await upload(app, owner.cookie, { contentType: 'image/png', data: PNG });

    expect(res.statusCode).toBe(200);
  });
});

describe('DELETE /pages/avatar', () => {
  it('refuses an unauthenticated caller', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/pages/avatar', remoteAddress: from() });
    expect(res.statusCode).toBe(401);
  });

  it('answers NO_PAGE for an account with no page yet', async () => {
    const cookie = await anAccountWithoutPage();
    const res = await app.inject({ method: 'DELETE', url: '/pages/avatar', remoteAddress: from(), cookies: { [SESSION_COOKIE]: cookie } });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NO_PAGE');
  });

  it('clears the picture and removes its object', async () => {
    const owner = await anOwner();
    await upload(app, owner.cookie, { contentType: 'image/png', data: PNG });
    const key = await keyOf(owner.accountId);

    const res = await app.inject({ method: 'DELETE', url: '/pages/avatar', remoteAddress: from(), cookies: { [SESSION_COOKIE]: owner.cookie } });

    expect(res.statusCode).toBe(200);
    expect(await keyOf(owner.accountId)).toBeNull();
    expect(store.remove).toHaveBeenLastCalledWith(key);
  });
});
