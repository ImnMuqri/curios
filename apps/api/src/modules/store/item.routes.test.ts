import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { createSession, SESSION_COOKIE } from '../auth/session.service.js';
import type { AvatarStore } from '../pages/storage.js';

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

describe('Ask items (ask for a price)', () => {
  const linkItem = { kind: 'DIGITAL', delivery: 'LINK', accessUrl: 'https://notion.so/private' };

  it('creates an Ask item with a starting price, or none, and no options', async () => {
    const owner = await anOwner(app);
    const started = await call(app, 'POST', '/store/items', owner.cookie, { name: 'Kek kahwin', pricing: { kind: 'ask', fromCents: 18000 } });
    expect(started.statusCode).toBe(201);
    expect(started.json().item).toMatchObject({ askForPrice: true, priceCents: 18000, options: [], kind: 'PHYSICAL' });
    const none = await call(app, 'POST', '/store/items', owner.cookie, { name: 'Kek custom', pricing: { kind: 'ask', fromCents: null } });
    expect(none.statusCode).toBe(201);
    expect(none.json().item).toMatchObject({ askForPrice: true, priceCents: null, options: [] });
    const stored = await app.prisma.item.findUniqueOrThrow({ where: { id: none.json().item.id as string }, select: { askForPrice: true, priceCents: true } });
    expect(stored).toEqual({ askForPrice: true, priceCents: null });
  });

  it('refuses a starting price of zero or above the most with INVALID_ITEM', async () => {
    const owner = await anOwner(app);
    for (const fromCents of [0, -5, 1_000_001]) {
      const res = await call(app, 'POST', '/store/items', owner.cookie, { name: 'Kek kahwin', pricing: { kind: 'ask', fromCents } });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('INVALID_ITEM');
    }
  });

  it('switching an options item to ask drops the options; switching back to single or options clears askForPrice', async () => {
    const owner = await anOwner(app);
    const id = (await call(app, 'POST', '/store/items', owner.cookie, cake)).json().item.id as string;

    const asked = await call(app, 'PATCH', `/store/items/${id}`, owner.cookie, { pricing: { kind: 'ask', fromCents: 15000 } });
    expect(asked.statusCode).toBe(200);
    expect(asked.json().item).toMatchObject({ askForPrice: true, priceCents: 15000, options: [] });
    expect(await app.prisma.itemOption.count({ where: { itemId: id } })).toBe(0);

    const none = await call(app, 'PATCH', `/store/items/${id}`, owner.cookie, { pricing: { kind: 'ask', fromCents: null } });
    expect(none.json().item).toMatchObject({ askForPrice: true, priceCents: null });

    const single = await call(app, 'PATCH', `/store/items/${id}`, owner.cookie, { pricing: { kind: 'single', priceCents: 9000 } });
    expect(single.json().item).toMatchObject({ askForPrice: false, priceCents: 9000, options: [] });

    await call(app, 'PATCH', `/store/items/${id}`, owner.cookie, { pricing: { kind: 'ask', fromCents: null } });
    const options = await call(app, 'PATCH', `/store/items/${id}`, owner.cookie, { pricing: cake.pricing });
    expect(options.json().item).toMatchObject({ askForPrice: false, priceCents: null, options: [{ label: '1kg' }, { label: '2kg' }] });
  });

  it('a PATCH without pricing leaves askForPrice as it was', async () => {
    const owner = await anOwner(app);
    const id = (await call(app, 'POST', '/store/items', owner.cookie, { name: 'Kek kahwin', pricing: { kind: 'ask', fromCents: 18000 } })).json().item.id as string;
    expect((await call(app, 'PATCH', `/store/items/${id}`, owner.cookie, { name: 'Kek kahwin 3 tingkat' })).json().item).toMatchObject({ askForPrice: true, priceCents: 18000 });
  });

  it('refuses ask pricing on a digital item, on create', async () => {
    const owner = await anOwner(app);
    const res = await call(app, 'POST', '/store/items', owner.cookie, { name: 'Recipe e-book', pricing: { kind: 'ask', fromCents: null }, ...linkItem });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_ITEM');
    expect(res.json().error.message).toMatch(/physical/i);
    expect(await app.prisma.item.count({ where: { pageId: owner.pageId } })).toBe(0);
  });

  it('refuses ask pricing on an existing digital item, and leaves it as it was', async () => {
    const owner = await anOwner(app);
    const id = (await call(app, 'POST', '/store/items', owner.cookie, { name: 'Recipe e-book', pricing: { kind: 'single', priceCents: 2500 }, ...linkItem })).json().item.id as string;
    const res = await call(app, 'PATCH', `/store/items/${id}`, owner.cookie, { pricing: { kind: 'ask', fromCents: 1000 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_ITEM');
    const stored = await app.prisma.item.findUniqueOrThrow({ where: { id }, select: { askForPrice: true, priceCents: true, kind: true } });
    expect(stored).toEqual({ askForPrice: false, priceCents: 2500, kind: 'DIGITAL' });
  });

  it('refuses making an Ask item digital, and rolls the whole change back', async () => {
    const owner = await anOwner(app);
    const id = (await call(app, 'POST', '/store/items', owner.cookie, { name: 'Kek kahwin', pricing: { kind: 'ask', fromCents: 18000 } })).json().item.id as string;
    const res = await call(app, 'PATCH', `/store/items/${id}`, owner.cookie, { name: 'Renamed', ...linkItem });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_ITEM');
    const stored = await app.prisma.item.findUniqueOrThrow({ where: { id }, select: { name: true, askForPrice: true, priceCents: true, kind: true, delivery: true, accessUrl: true } });
    expect(stored).toEqual({ name: 'Kek kahwin', askForPrice: true, priceCents: 18000, kind: 'PHYSICAL', delivery: null, accessUrl: null });
  });

  it('a digital item switched to single pricing stays fine (only ask is physical-only)', async () => {
    const owner = await anOwner(app);
    const id = (await call(app, 'POST', '/store/items', owner.cookie, { name: 'Kek kahwin', pricing: { kind: 'ask', fromCents: null } })).json().item.id as string;
    const res = await call(app, 'PATCH', `/store/items/${id}`, owner.cookie, { pricing: { kind: 'single', priceCents: 2500 }, ...linkItem });
    expect(res.statusCode).toBe(200);
    expect(res.json().item).toMatchObject({ askForPrice: false, kind: 'DIGITAL', priceCents: 2500 });
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

  it('an item code is optional, saved trimmed, and blank clears it', async () => {
    const owner = await anOwner(app);
    expect((await call(app, 'POST', '/store/items', owner.cookie, cookies)).json().item).toMatchObject({ sku: null });
    const made = await call(app, 'POST', '/store/items', owner.cookie, { ...cookies, name: 'Kek batik', sku: '  KB-500G ' });
    expect(made.json().item).toMatchObject({ sku: 'KB-500G' });
    const id = made.json().item.id as string;
    expect((await call(app, 'PATCH', `/store/items/${id}`, owner.cookie, { sku: 'KB-1KG' })).json().item).toMatchObject({ sku: 'KB-1KG' });
    expect((await call(app, 'PATCH', `/store/items/${id}`, owner.cookie, { sku: '  ' })).json().item).toMatchObject({ sku: null });
  });

  it('an item code over 40 characters is refused with a clear error', async () => {
    const owner = await anOwner(app);
    const res = await call(app, 'POST', '/store/items', owner.cookie, { ...cookies, sku: 'x'.repeat(41) });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({ code: 'INVALID_ITEM' });
    expect(res.json().error.message).toMatch(/item code to 40 characters/);
    expect((await call(app, 'POST', '/store/items', owner.cookie, { ...cookies, sku: 'x'.repeat(40) })).statusCode).toBe(201);
  });
});

describe('DELETE and order', () => {
  it('removes an item, closes the gap, and removes its photo object', async () => {
    const owner = await anOwner(app);
    const first = (await call(app, 'POST', '/store/items', owner.cookie, cookies)).json().item.id as string;
    await call(app, 'POST', '/store/items', owner.cookie, cake);
    const key = `items/${owner.pageId}/cover-${randomUUID()}.webp`;
    await app.prisma.item.update({ where: { id: first }, data: { photoKey: key } });

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
});

describe('choices pricing', () => {
  const choices = (over: Record<string, unknown> = {}) => ({
    kind: 'choices',
    groupOne: { name: 'Flavour', choices: [{ label: 'Vanilla' }, { label: 'Chocolate' }] },
    groupTwo: { name: 'Size', choices: [{ label: '500g' }, { label: '1kg' }] },
    combos: [
      { one: 0, two: 0, priceCents: 5000, available: true },
      { one: 0, two: 1, priceCents: 8000, available: true },
      { one: 1, two: 0, priceCents: 6000, available: true },
      { one: 1, two: 1, priceCents: 9000, available: false },
    ],
    ...over,
  });
  const body = (pricing: object) => ({ name: 'Kek', pricing });

  type Row = {
    id: string;
    priceCents: number | null;
    options: { id: string; label: string; priceCents: number }[];
    choices: null | {
      groupOne: { name: string; choices: { id: string; label: string; photoId: string | null; photoKey: string | null }[] };
      groupTwo: { name: string; choices: { id: string; label: string }[] } | null;
      combos: { id: string; label: string; oneId: string; twoId: string | null; priceCents: number; available: boolean }[];
    };
  };

  it('creates the combinations as options, with groups, choices and the on/off switch', async () => {
    const owner = await anOwner(app);
    const res = await call(app, 'POST', '/store/items', owner.cookie, body(choices()));
    expect(res.statusCode).toBe(201);
    const item = res.json<{ item: Row }>().item;
    expect(item.priceCents).toBeNull();
    expect(item.options.map((o) => [o.label, o.priceCents])).toEqual([['Vanilla · 500g', 5000], ['Vanilla · 1kg', 8000], ['Chocolate · 500g', 6000], ['Chocolate · 1kg', 9000]]);
    const groups = item.choices!;
    expect(groups.groupOne.name).toBe('Flavour');
    expect(groups.groupOne.choices.map((c) => c.label)).toEqual(['Vanilla', 'Chocolate']);
    expect(groups.groupTwo?.name).toBe('Size');
    expect(groups.groupTwo?.choices.map((c) => c.label)).toEqual(['500g', '1kg']);
    expect(groups.combos.map((c) => c.available)).toEqual([true, true, true, false]);
    const last = groups.combos[3]!;
    expect(last.oneId).toBe(groups.groupOne.choices[1]!.id);
    expect(last.twoId).toBe(groups.groupTwo!.choices[1]!.id);
    expect(last.id).toBe(item.options[3]!.id);
    // The owner's list reads the same.
    const listed = (await call(app, 'GET', '/store', owner.cookie)).json<{ items: Row[] }>().items[0]!;
    expect(listed.choices).toEqual(item.choices);
  });

  it('one group only: labels are the choices, and there is no second group', async () => {
    const owner = await anOwner(app);
    const res = await call(app, 'POST', '/store/items', owner.cookie, body({ kind: 'choices', groupOne: { name: 'Size', choices: [{ label: '1kg' }, { label: '2kg' }] }, combos: [{ one: 0, priceCents: 9500, available: true }, { one: 1, priceCents: 17000, available: true }] }));
    const item = res.json<{ item: Row }>().item;
    expect(item.options.map((o) => o.label)).toEqual(['1kg', '2kg']);
    expect(item.choices?.groupTwo).toBeNull();
    expect(item.choices?.combos.map((c) => c.twoId)).toEqual([null, null]);
  });

  it("attaches a photo of the item to a group-one choice, and refuses another item's", async () => {
    const owner = await anOwner(app);
    const other = await anOwner(app);
    const item = (await call(app, 'POST', '/store/items', owner.cookie, cookies)).json<{ item: Row }>().item;
    const photo = (itemId: string) =>
      app.prisma.itemPhoto.create({ data: { itemId, position: 0, originalKey: `item-photos/${randomUUID()}.png`, squareKey: `items/${randomUUID()}.webp`, width: 800, height: 800, frameX: 0, frameY: 0, frameSize: 1 }, select: { id: true } });
    const mine = await photo(item.id);
    const otherItem = (await call(app, 'POST', '/store/items', other.cookie, cookies)).json<{ item: Row }>().item;
    const theirs = await photo(otherItem.id);

    const withPhoto = (photoId: string) => choices({ groupOne: { name: 'Flavour', choices: [{ label: 'Vanilla', photoId }, { label: 'Chocolate' }] } });
    expect((await call(app, 'PATCH', `/store/items/${item.id}`, owner.cookie, { pricing: withPhoto(theirs.id) })).json().error.code).toBe('INVALID_ITEM');
    // A new item has no photos yet.
    expect((await call(app, 'POST', '/store/items', owner.cookie, body(withPhoto(mine.id)))).json().error.code).toBe('INVALID_ITEM');

    const ok = await call(app, 'PATCH', `/store/items/${item.id}`, owner.cookie, { pricing: withPhoto(mine.id) });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<{ item: Row }>().item.choices?.groupOne.choices[0]).toMatchObject({ label: 'Vanilla', photoId: mine.id, photoKey: expect.stringMatching(/^items\/.*\.webp$/) });
  });

  it('refuses a broken grid with INVALID_ITEM and saves nothing', async () => {
    const owner = await anOwner(app);
    const grid = choices().combos;
    for (const pricing of [
      choices({ combos: grid.slice(1) }),
      choices({ combos: [grid[0], grid[0], grid[2], grid[3]] }),
      choices({ combos: grid.map((c) => ({ ...c, available: false })) }),
      choices({ combos: grid.map((c) => ({ ...c, priceCents: 0 })) }),
      choices({ combos: grid.map((c) => ({ ...c, priceCents: 1_000_001 })) }),
      choices({ groupOne: { name: 'Flavour', choices: Array.from({ length: 11 }, (_, i) => ({ label: `c${i}` })) } }),
      choices({ groupOne: { name: 'x'.repeat(41), choices: [{ label: 'a' }, { label: 'b' }] } }),
      choices({ groupOne: { name: 'Flavour', choices: [{ label: 'A · B' }, { label: 'b' }] } }),
    ]) {
      expect((await call(app, 'POST', '/store/items', owner.cookie, body(pricing))).json().error.code).toBe('INVALID_ITEM');
    }
    expect(await names(owner.cookie)).toEqual([]);
  });

  it('a save replaces the options and choices whole, and a refused save keeps the old ones', async () => {
    const owner = await anOwner(app);
    const item = (await call(app, 'POST', '/store/items', owner.cookie, body(choices()))).json<{ item: Row }>().item;
    const failed = await call(app, 'PATCH', `/store/items/${item.id}`, owner.cookie, { pricing: choices({ combos: [] }) });
    expect(failed.json().error.code).toBe('INVALID_ITEM');
    expect(await app.prisma.itemChoice.count({ where: { itemId: item.id } })).toBe(4);

    const next = await call(app, 'PATCH', `/store/items/${item.id}`, owner.cookie, { pricing: { kind: 'choices', groupOne: { name: 'Size', choices: [{ label: 'S' }] }, combos: [{ one: 0, priceCents: 700, available: true }] } });
    expect(next.json<{ item: Row }>().item.options.map((o) => o.label)).toEqual(['S']);
    expect(await app.prisma.itemChoice.count({ where: { itemId: item.id } })).toBe(1);
    expect(await app.prisma.itemOption.count({ where: { itemId: item.id } })).toBe(1);
  });

  it('switching to one price, plain options or ask clears the groups, choices and combinations', async () => {
    const owner = await anOwner(app);
    for (const pricing of [{ kind: 'single', priceCents: 1200 }, { kind: 'options', options: [{ label: '1kg', priceCents: 9500 }] }, { kind: 'ask', fromCents: null }]) {
      const item = (await call(app, 'POST', '/store/items', owner.cookie, body(choices()))).json<{ item: Row }>().item;
      const res = await call(app, 'PATCH', `/store/items/${item.id}`, owner.cookie, { pricing });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ item: Row }>().item.choices).toBeNull();
      expect(await app.prisma.itemChoice.count({ where: { itemId: item.id } })).toBe(0);
      const row = await app.prisma.item.findUniqueOrThrow({ where: { id: item.id }, select: { choiceGroupOne: true, choiceGroupTwo: true } });
      expect(row).toEqual({ choiceGroupOne: null, choiceGroupTwo: null });
    }
  });

  it('a plain options item reads exactly as before, with no choices', async () => {
    const owner = await anOwner(app);
    const item = (await call(app, 'POST', '/store/items', owner.cookie, cake)).json<{ item: Row }>().item;
    expect(item.choices).toBeNull();
    expect(item.options.map((o) => o.label)).toEqual(['1kg', '2kg']);
  });

  it('deleting a photo leaves its choice, without the photo', async () => {
    const owner = await anOwner(app);
    const item = (await call(app, 'POST', '/store/items', owner.cookie, cookies)).json<{ item: Row }>().item;
    const photo = await app.prisma.itemPhoto.create({ data: { itemId: item.id, position: 0, originalKey: `item-photos/${randomUUID()}.png`, squareKey: `items/${randomUUID()}.webp`, width: 800, height: 800, frameX: 0, frameY: 0, frameSize: 1 }, select: { id: true } });
    await call(app, 'PATCH', `/store/items/${item.id}`, owner.cookie, { pricing: choices({ groupOne: { name: 'Flavour', choices: [{ label: 'Vanilla', photoId: photo.id }, { label: 'Chocolate' }] } }) });
    await app.prisma.itemPhoto.delete({ where: { id: photo.id } });
    const listed = (await call(app, 'GET', '/store', owner.cookie)).json<{ items: Row[] }>().items[0]!;
    expect(listed.choices?.groupOne.choices[0]).toMatchObject({ label: 'Vanilla', photoId: null, photoKey: null });
  });
});
