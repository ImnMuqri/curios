import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { createSession, SESSION_COOKIE } from '../auth/session.service.js';
import type { AvatarStore } from '../pages/storage.js';

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

async function anOwner(on: FastifyInstance, mode: 'BUSINESS' | 'PERSONAL' = 'BUSINESS') {
  const slug = randomUUID().slice(0, 8);
  const account = await on.prisma.account.create({
    data: {
      email: `store-${randomUUID()}@example.com`,
      emailVerifiedAt: new Date(),
      pages: { create: { handle: `st-${slug}`, skeleton: `st-${slug}`, displayName: 'Kek Lina', mode } },
    },
    select: { id: true, pages: { select: { id: true } } },
  });
  return { cookie: (await createSession(on.prisma, account.id)).value, pageId: account.pages[0]?.id ?? '' };
}

const call = (on: FastifyInstance, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, cookie?: string, payload?: object) =>
  on.inject({ method, url, remoteAddress: from(), ...(cookie ? { cookies: { [SESSION_COOKIE]: cookie } } : {}), ...(payload ? { payload } : {}) });

const bank = { bankName: 'Maybank', bankAccountName: 'Lina binti Ahmad', bankAccountNumber: '5140 1234 5678' };

describe('the store gate', () => {
  it('refuses without a session', async () => {
    expect((await call(app, 'GET', '/store')).statusCode).toBe(401);
  });

  // Review Focus 3.
  it('refuses a personal page on every store route', async () => {
    const owner = await anOwner(app, 'PERSONAL');
    for (const [method, url, payload] of [
      ['GET', '/store', undefined],
      ['PATCH', '/store/settings', { pickupEnabled: true }],
      ['POST', '/store/payment-qr', { contentType: 'image/png', data: PNG }],
    ] as const) {
      const res = await call(app, method, url, owner.cookie, payload);
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('STORE_BUSINESS_ONLY');
    }
  });
});

describe('the store gate with storage off', () => {
  // The gate runs before the storage check, so a personal page is told the real reason.
  it('tells a personal page it is business only, not that storage is off', async () => {
    const owner = await anOwner(off, 'PERSONAL');
    const res = await call(off, 'POST', '/store/payment-qr', owner.cookie, { contentType: 'image/png', data: PNG });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('STORE_BUSINESS_ONLY');
  });
});

describe('GET /store', () => {
  it('starts closed, with nothing set', async () => {
    const owner = await anOwner(app);
    const res = await call(app, 'GET', '/store', owner.cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      settings: { enabled: false, shopDescription: null, pickupEnabled: false, deliveryMode: 'NONE', deliveryFeeCents: null, minNoticeDays: 1, paymentQrKey: null, tileSize: null },
      items: [],
    });
  });
});

describe('PATCH /store/settings', () => {
  it('saves pickup, bank details (normalised) and notice', async () => {
    const owner = await anOwner(app);
    const res = await call(app, 'PATCH', '/store/settings', owner.cookie, { pickupEnabled: true, pickupNote: ' Seksyen 7 ', minNoticeDays: 2, ...bank });
    expect(res.statusCode).toBe(200);
    expect(res.json().settings).toMatchObject({ pickupEnabled: true, pickupNote: 'Seksyen 7', minNoticeDays: 2, bankAccountNumber: '514012345678' });
  });

  it('refuses to open a shop with no way to pay, saying what is missing', async () => {
    const owner = await anOwner(app);
    const res = await call(app, 'PATCH', '/store/settings', owner.cookie, { enabled: true, pickupEnabled: true });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({ code: 'STORE_NOT_READY' });
    expect(res.json().error.message).toMatch(/way to pay/);
  });

  it('opens a ready shop in the same request that makes it ready', async () => {
    const owner = await anOwner(app);
    const res = await call(app, 'PATCH', '/store/settings', owner.cookie, { enabled: true, pickupEnabled: true, ...bank });
    expect(res.statusCode).toBe(200);
    expect(res.json().settings.enabled).toBe(true);
  });

  it('refuses to take away the last way to hand over while open', async () => {
    const owner = await anOwner(app);
    await call(app, 'PATCH', '/store/settings', owner.cookie, { enabled: true, pickupEnabled: true, ...bank });
    const res = await call(app, 'PATCH', '/store/settings', owner.cookie, { pickupEnabled: false });
    expect(res.json().error.code).toBe('STORE_NOT_READY');
  });

  it('needs a fee for flat delivery, and drops it for any other mode', async () => {
    const owner = await anOwner(app);
    expect((await call(app, 'PATCH', '/store/settings', owner.cookie, { deliveryMode: 'FLAT' })).json().error.code).toBe('INVALID_STORE_SETTING');
    const flat = await call(app, 'PATCH', '/store/settings', owner.cookie, { deliveryMode: 'FLAT', deliveryFeeCents: 1000 });
    expect(flat.json().settings).toMatchObject({ deliveryMode: 'FLAT', deliveryFeeCents: 1000 });
    const rider = await call(app, 'PATCH', '/store/settings', owner.cookie, { deliveryMode: 'RIDER' });
    expect(rider.json().settings).toMatchObject({ deliveryMode: 'RIDER', deliveryFeeCents: null });
  });

  it('saves a shop description, tidied, and clears it when blank', async () => {
    const owner = await anOwner(app);
    const set = await call(app, 'PATCH', '/store/settings', owner.cookie, { shopDescription: '  Homemade cakes,\n baked fresh.  ' });
    expect(set.json().settings.shopDescription).toBe('Homemade cakes, baked fresh.');
    const cleared = await call(app, 'PATCH', '/store/settings', owner.cookie, { shopDescription: '   ' });
    expect(cleared.json().settings.shopDescription).toBeNull();
  });

  it('refuses a bad account number, an over-long note or description, and an impossible notice', async () => {
    const owner = await anOwner(app);
    for (const patch of [{ bankAccountNumber: '12ab' }, { pickupNote: 'x'.repeat(121) }, { shopDescription: 'x'.repeat(161) }, { minNoticeDays: 31 }, { minNoticeDays: -1 }]) {
      expect((await call(app, 'PATCH', '/store/settings', owner.cookie, patch)).json().error.code).toBe('INVALID_STORE_SETTING');
    }
  });
});

describe('the payment QR', () => {
  it('uploads, replaces (removing the old object), and removes', async () => {
    const owner = await anOwner(app);
    const first = (await call(app, 'POST', '/store/payment-qr', owner.cookie, { contentType: 'image/png', data: PNG })).json().paymentQrKey as string;
    expect(first).toMatch(new RegExp(`^qr/${owner.pageId}/`));
    const second = (await call(app, 'POST', '/store/payment-qr', owner.cookie, { contentType: 'image/png', data: PNG })).json().paymentQrKey as string;
    expect(store.remove).toHaveBeenCalledWith(first);
    expect((await call(app, 'DELETE', '/store/payment-qr', owner.cookie)).statusCode).toBe(200);
    expect(store.remove).toHaveBeenCalledWith(second);
  });

  // Review Focus 2.
  it('will not remove the only way to pay from an open shop', async () => {
    const owner = await anOwner(app);
    await call(app, 'POST', '/store/payment-qr', owner.cookie, { contentType: 'image/png', data: PNG });
    await call(app, 'PATCH', '/store/settings', owner.cookie, { enabled: true, pickupEnabled: true });
    const res = await call(app, 'DELETE', '/store/payment-qr', owner.cookie);
    expect(res.json().error.code).toBe('STORE_NOT_READY');
    expect((await call(app, 'GET', '/store', owner.cookie)).json().settings.paymentQrKey).not.toBeNull();
  });

  it('says uploads are off where storage is not configured', async () => {
    const owner = await anOwner(off);
    const res = await call(off, 'POST', '/store/payment-qr', owner.cookie, { contentType: 'image/png', data: PNG });
    expect(res.json().error.code).toBe('STORAGE_NOT_CONFIGURED');
  });
});
