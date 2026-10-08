import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
beforeEach(() => {
  store.put.mockClear();
  store.remove.mockClear();
});

async function anOwner(on = app) {
  const slug = randomUUID().slice(0, 8);
  const account = await on.prisma.account.create({
    data: { email: `cover-${randomUUID()}@example.com`, emailVerifiedAt: new Date(), pages: { create: { handle: `cv-${slug}`, skeleton: `cv-${slug}`, displayName: 'Lina' } } },
    select: { id: true },
  });
  return { accountId: account.id, cookie: (await createSession(on.prisma, account.id)).value };
}

const call = (on: FastifyInstance, method: 'POST' | 'PUT' | 'DELETE', url: string, cookie?: string, payload?: object) =>
  on.inject({ method, url, remoteAddress: from(), ...(cookie ? { cookies: { [SESSION_COOKIE]: cookie } } : {}), ...(payload ? { payload } : {}) });

const coverOf = async (accountId: string) =>
  (await app.prisma.page.findUniqueOrThrow({ where: { accountId }, select: { coverKey: true } })).coverKey;

describe('the cover photo', () => {
  it('refuses every cover route without a session', async () => {
    expect((await call(app, 'POST', '/pages/cover', undefined, { contentType: 'image/png', data: PNG })).statusCode).toBe(401);
    expect((await call(app, 'PUT', '/pages/cover/stock', undefined, { name: 'kedai' })).statusCode).toBe(401);
    expect((await call(app, 'DELETE', '/pages/cover')).statusCode).toBe(401);
  });

  it('stores an uploaded cover under a fresh key and records it', async () => {
    const owner = await anOwner();
    const res = await call(app, 'POST', '/pages/cover', owner.cookie, { contentType: 'image/png', data: PNG });

    expect(res.statusCode).toBe(200);
    const key = await coverOf(owner.accountId);
    expect(key).toMatch(/^covers\/[^/]+\/[0-9a-f-]+\.png$/);
    expect(store.put).toHaveBeenLastCalledWith(key, expect.any(Buffer), 'image/png');
  });

  it('refuses a file that is not the picture it claims to be', async () => {
    const owner = await anOwner();
    const res = await call(app, 'POST', '/pages/cover', owner.cookie, { contentType: 'image/jpeg', data: PNG });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_IMAGE');
    expect(await coverOf(owner.accountId)).toBeNull();
  });

  it('sets a stock cover without touching storage, even where uploads are off', async () => {
    const owner = await anOwner(off);
    const res = await call(off, 'PUT', '/pages/cover/stock', owner.cookie, { name: 'kopi' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ coverKey: 'stock/kopi' });
  });

  it('refuses a stock cover that does not ship with Curios', async () => {
    const owner = await anOwner();
    const res = await call(app, 'PUT', '/pages/cover/stock', owner.cookie, { name: '../../secret' });
    expect(res.statusCode).toBe(400);
    expect(await coverOf(owner.accountId)).toBeNull();
  });

  it('lets go of an uploaded cover when a stock one replaces it, but never deletes a stock cover', async () => {
    const owner = await anOwner();
    await call(app, 'POST', '/pages/cover', owner.cookie, { contentType: 'image/png', data: PNG });
    const uploaded = await coverOf(owner.accountId);

    await call(app, 'PUT', '/pages/cover/stock', owner.cookie, { name: 'teh' });
    await vi.waitFor(() => expect(store.remove).toHaveBeenCalledWith(uploaded));

    store.remove.mockClear();
    await call(app, 'PUT', '/pages/cover/stock', owner.cookie, { name: 'bunga' });
    await call(app, 'DELETE', '/pages/cover', owner.cookie);
    expect(store.remove).not.toHaveBeenCalled();
    expect(await coverOf(owner.accountId)).toBeNull();
  });

  it('says uploads are switched off rather than failing quietly', async () => {
    const owner = await anOwner(off);
    const res = await call(off, 'POST', '/pages/cover', owner.cookie, { contentType: 'image/png', data: PNG });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('STORAGE_NOT_CONFIGURED');
  });
});

describe('the background band', () => {
  it('saves a band and refuses one that is not in the palette', async () => {
    const owner = await anOwner();
    const ok = await app.inject({ method: 'PATCH', url: '/pages/appearance', remoteAddress: from(), cookies: { [SESSION_COOKIE]: owner.cookie }, payload: { background: 'INK' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().appearance.background).toBe('INK');

    const bad = await app.inject({ method: 'PATCH', url: '/pages/appearance', remoteAddress: from(), cookies: { [SESSION_COOKIE]: owner.cookie }, payload: { background: 'NEON' } });
    expect(bad.statusCode).toBe(400);
  });
});
