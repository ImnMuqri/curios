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

const cake = { name: 'Kek Batik', description: 'Nutella, tahan 5 hari', pricing: { kind: 'options', options: [{ label: '1kg', priceCents: 9500 }, { label: '2kg', priceCents: 17000 }] } };
const cookies = { name: 'Cookies balang', pricing: { kind: 'single', priceCents: 2500 } };

const names = async (cookie: string) =>
  (await call(app, 'GET', '/store', cookie)).json<{ items: { name: string }[] }>().items.map((i) => i.name);

describe('POST /store/items', () => {
  it('adds items last, with options in the order given', async () => {
    const owner = await anOwner(app);
    await call(app, 'POST', '/store/items', owner.cookie, cookies);
    const res = await call(app, 'POST', '/store/items', owner.cookie, cake);
    expect(res.statusCode).toBe(201);
    expect(res.json().item).toMatchObject({ name: 'Kek Batik', priceCents: null, available: true, options: [{ label: '1kg', priceCents: 9500 }, { label: '2kg', priceCents: 17000 }] });
    expect(await names(owner.cookie)).toEqual(['Cookies balang', 'Kek Batik']);
  });

  it('refuses a blank name, a long description, and broken pricing with INVALID_ITEM', async () => {
    const owner = await anOwner(app);
    for (const body of [
      { ...cookies, name: '  ' },
      { ...cookies, description: 'x'.repeat(281) },
      { ...cookies, pricing: { kind: 'single', priceCents: 0 } },
      { ...cookies, pricing: { kind: 'single', priceCents: 95.5 } },
      { ...cookies, pricing: { kind: 'options', options: [] } },
    ]) {
      expect((await call(app, 'POST', '/store/items', owner.cookie, body)).json().error.code).toBe('INVALID_ITEM');
    }
  });

  it('stops at the item limit', async () => {
    const owner = await anOwner(app);
    await app.prisma.item.createMany({ data: Array.from({ length: 40 }, (_, position) => ({ pageId: owner.pageId, name: `i${position}`, slug: `i${position}`, priceCents: 100, position })) });
    expect((await call(app, 'POST', '/store/items', owner.cookie, cookies)).json().error.code).toBe('ITEM_LIMIT');
  });

  // Review Focus 3.
  it('refuses a personal page', async () => {
    const owner = await anOwner(app, 'PERSONAL');
    expect((await call(app, 'POST', '/store/items', owner.cookie, cookies)).json().error.code).toBe('STORE_BUSINESS_ONLY');
  });
});

describe('PATCH /store/items/:id', () => {
  it('switches an item from options to one price, dropping the options', async () => {
    const owner = await anOwner(app);
    const id = (await call(app, 'POST', '/store/items', owner.cookie, cake)).json().item.id as string;
    const res = await call(app, 'PATCH', `/store/items/${id}`, owner.cookie, { pricing: { kind: 'single', priceCents: 9000 } });
    expect(res.json().item).toMatchObject({ priceCents: 9000, options: [] });
    expect(await app.prisma.itemOption.count({ where: { itemId: id } })).toBe(0);
  });

  it('turns availability off without touching the price', async () => {
    const owner = await anOwner(app);
    const id = (await call(app, 'POST', '/store/items', owner.cookie, cookies)).json().item.id as string;
    expect((await call(app, 'PATCH', `/store/items/${id}`, owner.cookie, { available: false })).json().item).toMatchObject({ available: false, priceCents: 2500 });
  });

  it("cannot reach another owner's item", async () => {
    const a = await anOwner(app);
    const b = await anOwner(app);
    const id = (await call(app, 'POST', '/store/items', a.cookie, cookies)).json().item.id as string;
    expect((await call(app, 'PATCH', `/store/items/${id}`, b.cookie, { name: 'mine now' })).statusCode).toBe(404);
    expect((await call(app, 'DELETE', `/store/items/${id}`, b.cookie)).statusCode).toBe(404);
  });
});

describe('item link, category and tag', () => {
  it('a new item gets a slug from its name', async () => {
    const owner = await anOwner(app);
    const res = await call(app, 'POST', '/store/items', owner.cookie, cake);
    expect(res.json().item.slug).toBe('kek-batik');
    const chinese = await call(app, 'POST', '/store/items', owner.cookie, { ...cookies, name: '红豆糕' });
    expect(chinese.json().item.slug).toBe('item');
  });

  it('a clashing name gets -2, then -3, and another page may reuse the slug', async () => {
    const owner = await anOwner(app);
    const slugs: string[] = [];
    for (const name of ['Kek Batik', 'kek batik!', 'Kek  Batik']) {
      slugs.push((await call(app, 'POST', '/store/items', owner.cookie, { ...cookies, name })).json().item.slug as string);
    }
    expect(slugs).toEqual(['kek-batik', 'kek-batik-2', 'kek-batik-3']);
    const other = await anOwner(app);
    expect((await call(app, 'POST', '/store/items', other.cookie, { ...cookies, name: 'Kek Batik' })).json().item.slug).toBe('kek-batik');
  });

  it('renaming an item keeps its slug', async () => {
    const owner = await anOwner(app);
    const id = (await call(app, 'POST', '/store/items', owner.cookie, cookies)).json().item.id as string;
    const res = await call(app, 'PATCH', `/store/items/${id}`, owner.cookie, { name: 'Something else entirely' });
    expect(res.json().item).toMatchObject({ name: 'Something else entirely', slug: 'cookies-balang' });
    // A new item with the old name is a new item: it must not take the frozen slug.
    const again = await call(app, 'POST', '/store/items', owner.cookie, { ...cookies, name: 'Cookies balang' });
    expect(again.json().item.slug).toBe('cookies-balang-2');
  });

  it('category and tag are saved and trimmed; blank clears them', async () => {
    const owner = await anOwner(app);
    const made = await call(app, 'POST', '/store/items', owner.cookie, { ...cookies, category: '  Kuih  ', tag: ' Best seller ' });
    expect(made.json().item).toMatchObject({ category: 'Kuih', tag: 'Best seller' });
    const id = made.json().item.id as string;
    const changed = await call(app, 'PATCH', `/store/items/${id}`, owner.cookie, { tag: 'Raya special' });
    expect(changed.json().item).toMatchObject({ category: 'Kuih', tag: 'Raya special' });
    const cleared = await call(app, 'PATCH', `/store/items/${id}`, owner.cookie, { category: '   ', tag: null });
    expect(cleared.json().item).toMatchObject({ category: null, tag: null });
  });

  it('a tag over 20 characters is refused with a clear error', async () => {
    const owner = await anOwner(app);
    const res = await call(app, 'POST', '/store/items', owner.cookie, { ...cookies, tag: 'x'.repeat(21) });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({ code: 'INVALID_ITEM' });
    expect(res.json().error.message).toMatch(/20 characters/);
    const id = (await call(app, 'POST', '/store/items', owner.cookie, cookies)).json().item.id as string;
    expect((await call(app, 'PATCH', `/store/items/${id}`, owner.cookie, { tag: 'y'.repeat(21) })).json().error.code).toBe('INVALID_ITEM');
    expect((await call(app, 'POST', '/store/items', owner.cookie, { ...cookies, tag: 'x'.repeat(20) })).statusCode).toBe(201);
  });
});

describe('DELETE, order, photo', () => {
  it('removes an item, closes the gap, and removes its photo object', async () => {
    const owner = await anOwner(app);
    const first = (await call(app, 'POST', '/store/items', owner.cookie, cookies)).json().item.id as string;
    await call(app, 'POST', '/store/items', owner.cookie, cake);
    const key = (await call(app, 'POST', `/store/items/${first}/photo`, owner.cookie, { contentType: 'image/png', data: PNG })).json().photoKey as string;
    expect(key).toMatch(new RegExp(`^items/${owner.pageId}/`));

    expect((await call(app, 'DELETE', `/store/items/${first}`, owner.cookie)).statusCode).toBe(200);
    expect(store.remove).toHaveBeenCalledWith(key);
    const rest = await app.prisma.item.findMany({ where: { pageId: owner.pageId }, select: { position: true } });
    expect(rest).toEqual([{ position: 0 }]);
  });

  it('reorders only against the current set', async () => {
    const owner = await anOwner(app);
    const a = (await call(app, 'POST', '/store/items', owner.cookie, cookies)).json().item.id as string;
    const b = (await call(app, 'POST', '/store/items', owner.cookie, cake)).json().item.id as string;
    expect((await call(app, 'PUT', '/store/items/order', owner.cookie, { ids: [b, a] })).statusCode).toBe(200);
    expect(await names(owner.cookie)).toEqual(['Kek Batik', 'Cookies balang']);
    expect((await call(app, 'PUT', '/store/items/order', owner.cookie, { ids: [b] })).json().error.code).toBe('ITEM_ORDER_STALE');
  });

  it("will not store a photo for another owner's item", async () => {
    const a = await anOwner(app);
    const b = await anOwner(app);
    const id = (await call(app, 'POST', '/store/items', a.cookie, cookies)).json().item.id as string;
    const res = await call(app, 'POST', `/store/items/${id}/photo`, b.cookie, { contentType: 'image/png', data: PNG });
    expect(res.statusCode).toBe(404);
    expect(store.put).not.toHaveBeenCalled();
  });

  it('replaces a photo, removing the old object, and clears it', async () => {
    const owner = await anOwner(app);
    const id = (await call(app, 'POST', '/store/items', owner.cookie, cookies)).json().item.id as string;
    const first = (await call(app, 'POST', `/store/items/${id}/photo`, owner.cookie, { contentType: 'image/png', data: PNG })).json().photoKey as string;
    const second = (await call(app, 'POST', `/store/items/${id}/photo`, owner.cookie, { contentType: 'image/png', data: PNG })).json().photoKey as string;
    expect(store.remove).toHaveBeenCalledWith(first);
    expect((await call(app, 'DELETE', `/store/items/${id}/photo`, owner.cookie)).json()).toEqual({ photoKey: null });
    expect(store.remove).toHaveBeenCalledWith(second);
  });
});

describe('item bookkeeping', () => {
  it('numbers items from zero and lists options by position, not insertion', async () => {
    const owner = await anOwner(app);
    await call(app, 'POST', '/store/items', owner.cookie, cookies);
    const id = (await call(app, 'POST', '/store/items', owner.cookie, cake)).json().item.id as string;
    const positions = await app.prisma.item.findMany({ where: { pageId: owner.pageId }, orderBy: { position: 'asc' }, select: { position: true } });
    expect(positions).toEqual([{ position: 0 }, { position: 1 }]);
    await app.prisma.itemOption.deleteMany({ where: { itemId: id } });
    await app.prisma.itemOption.create({ data: { itemId: id, label: 'second', priceCents: 200, position: 1 } });
    await app.prisma.itemOption.create({ data: { itemId: id, label: 'first', priceCents: 100, position: 0 } });
    const items = (await call(app, 'GET', '/store', owner.cookie)).json<{ items: { id: string; options: { label: string }[] }[] }>().items;
    expect(items.find((i) => i.id === id)?.options.map((o) => o.label)).toEqual(['first', 'second']);
  });

  it('refuses an order naming an item that is not there, even at the right length', async () => {
    const owner = await anOwner(app);
    const a = (await call(app, 'POST', '/store/items', owner.cookie, cookies)).json().item.id as string;
    await call(app, 'POST', '/store/items', owner.cookie, cake);
    expect((await call(app, 'PUT', '/store/items/order', owner.cookie, { ids: [a, 'nope'] })).json().error.code).toBe('ITEM_ORDER_STALE');
  });

  it('really clears the photo column', async () => {
    const owner = await anOwner(app);
    const id = (await call(app, 'POST', '/store/items', owner.cookie, cookies)).json().item.id as string;
    await call(app, 'POST', `/store/items/${id}/photo`, owner.cookie, { contentType: 'image/png', data: PNG });
    await call(app, 'DELETE', `/store/items/${id}/photo`, owner.cookie);
    expect((await app.prisma.item.findUnique({ where: { id }, select: { photoKey: true } }))?.photoKey).toBeNull();
  });
});
