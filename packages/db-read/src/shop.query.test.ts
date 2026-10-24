import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getPublicPage } from './page.query.js';
import { prismaRead } from './client.js';
import { getOwnerStore, getPublicShop } from './shop.query.js';

const write = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });
const EMAIL = '@shop-query.example.com';
let openAccountId = '';
let orderAccountId = '';
let chipAccountId = '';
let digitalAccountId = '';
const CHECKED = new Date('2026-10-23T02:00:00Z');

const shelf = [
  { name: 'A', slug: 'a', category: 'Cakes', tag: 'New', priceCents: 1000, position: 0, available: true },
  { name: 'B', slug: 'b', priceCents: 2000, position: 1, available: false, photoKey: 'items/p/b.webp' },
  {
    name: 'C',
    slug: 'c',
    position: 2,
    available: true,
    photoKey: 'items/p/c.webp',
    options: { create: [{ label: '2kg', priceCents: 17000, position: 1 }, { label: '1kg', priceCents: 9500, position: 0 }] },
  },
];

async function seed(handle: string, page: Record<string, unknown>) {
  const account = await write.account.create({
    data: {
      email: `${handle}${EMAIL}`,
      pages: { create: { handle, skeleton: handle, displayName: 'Kek Lina', published: true, mode: 'BUSINESS', storeEnabled: true, pickupEnabled: true, paymentQrKey: 'qr/p/x.png', items: { create: shelf }, ...page } },
    },
    select: { id: true },
  });
  return account.id;
}

beforeAll(async () => {
  await write.account.deleteMany({ where: { email: { endsWith: EMAIL } } });
  openAccountId = await seed('sq-open', { shopDescription: 'Homemade cakes, baked fresh.', closedDays: [0, 3], deliveryNote: 'Around Shah Alam' });
  await seed('sq-halal', { shopHalal: true });
  await seed('sq-closed', { storeEnabled: false });
  await seed('sq-personal', { mode: 'PERSONAL' });
  await seed('sq-draft', { published: false });
  await seed('sq-suspended', { suspendedAt: new Date(), suspendReason: 'Scam reports' });
  await seed('sq-many', {
    items: { create: ['M1', 'M2', 'M3', 'M4'].map((name, position) => ({ name, slug: name.toLowerCase(), position, available: true })) },
  });
  chipAccountId = await seed('sq-chip', {
    paymentAccount: {
      create: { brandId: 'brand-1a2b', brandName: 'Kek Lina Bakes', secretKeyCiphertext: 'sealed-box', publicKeyPem: 'pem', methods: ['fpx', 'visa'], checkedAt: CHECKED },
    },
  });
  digitalAccountId = await seed('sq-digital', {
    items: { create: [
      { name: 'Book', slug: 'book', position: 0, available: true, priceCents: 2500, kind: 'DIGITAL', delivery: 'FILES', files: { create: [
        { key: 'digital/p/i/k2', name: 'two.pdf', sizeBytes: 20, contentType: 'application/pdf', position: 1 },
        { key: 'digital/p/i/k1', name: 'one.pdf', sizeBytes: 10, contentType: 'application/pdf', position: 0 },
      ] } },
      { name: 'Codes', slug: 'codes', position: 1, available: true, priceCents: 900, kind: 'DIGITAL', delivery: 'CODES', codes: { create: [{ code: 'AAA' }, { code: 'BBB' }, { code: 'CCC' }] } },
      { name: 'Class', slug: 'class', position: 2, available: true, priceCents: 6000, kind: 'DIGITAL', delivery: 'SESSION', sessionMinutes: 90, sessionPlace: 'ONLINE', sessionWhere: 'https://meet.example.com/x', sessions: { create: [
        { startsAt: new Date('2026-12-02T12:00:00Z'), seats: 5 },
        { startsAt: new Date('2026-12-01T12:00:00Z'), seats: 12 },
      ] } },
      { name: 'Cake', slug: 'cake', position: 3, available: true, priceCents: 4500, files: { create: [{ key: 'digital/p/i/old', name: 'old.pdf', sizeBytes: 5, contentType: 'application/pdf', position: 0 }] }, codes: { create: [{ code: 'OLD' }] } },
    ] },
  });
  // Created in the reverse of their positions, so insertion order cannot pass for position order.
  orderAccountId = await seed('sq-order', {
    items: { create: [
      { name: 'Second', slug: 'second', position: 1, available: true, photoKey: 'items/p/second.webp' },
      { name: 'First', slug: 'first', position: 0, available: true, photoKey: 'items/p/first.webp' },
    ] },
    links: { create: [
      { label: 'Two', url: 'https://two.example.com', position: 1 },
      { label: 'One', url: 'https://one.example.com', position: 0 },
    ] },
  });
});

afterAll(async () => {
  await write.account.deleteMany({ where: { email: { endsWith: EMAIL } } });
  await write.$disconnect();
});

describe('getPublicShop', () => {
  it('orders items and links by position, not by when they were made', async () => {
    const shop = await getPublicShop('sq-order');
    expect(shop?.items.map((item) => item.name)).toEqual(['First', 'Second']);
    expect(shop?.links.map((link) => link.label)).toEqual(['One', 'Two']);
  });

  it('returns available items only, in order, with options in order', async () => {
    const shop = await getPublicShop('SQ-OPEN');
    expect(shop?.items.map((item) => item.name)).toEqual(['A', 'C']);
    expect(shop?.items[1]?.options.map((option) => option.label)).toEqual(['1kg', '2kg']);
    expect(shop).not.toHaveProperty('paymentQrKey');
  });

  it('carries each item slug, category and tag, and the shop halal switch', async () => {
    const shop = await getPublicShop('sq-open');
    expect(shop?.items[0]).toMatchObject({ slug: 'a', category: 'Cakes', tag: 'New' });
    expect(shop?.items[1]).toMatchObject({ slug: 'c', category: null, tag: null });
    expect(shop?.shopHalal).toBe(false);
    expect((await getPublicShop('sq-halal'))?.shopHalal).toBe(true);
  });

  // Review Focus 3.
  it('carries the shop description, for above the items', async () => {
    expect((await getPublicShop('sq-open'))?.shopDescription).toBe('Homemade cakes, baked fresh.');
    expect((await getPublicShop('sq-order'))?.shopDescription).toBeNull();
  });

  it('carries the closed days and the delivery note, for checkout', async () => {
    expect(await getPublicShop('sq-open')).toMatchObject({ closedDays: [0, 3], deliveryNote: 'Around Shah Alam' });
    expect(await getPublicShop('sq-order')).toMatchObject({ closedDays: [], deliveryNote: null });
  });

  it('is null for a closed shop, a personal page, and an unpublished page', async () => {
    expect(await getPublicShop('sq-closed')).toBeNull();
    expect(await getPublicShop('sq-personal')).toBeNull();
    expect(await getPublicShop('sq-draft')).toBeNull();
  });

  it('is null for a suspended page, and the tile with it', async () => {
    expect(await getPublicShop('sq-suspended')).toBeNull();
    expect(await getPublicPage('sq-suspended')).toBeNull();
  });
});

describe('the tile on the public page', () => {
  it('counts available items and takes the first available photo', async () => {
    expect((await getPublicPage('sq-open'))?.shop).toEqual({
      position: 0,
      size: null,
      itemCount: 2,
      photoKey: 'items/p/c.webp',
      photos: [{ name: 'A', photoKey: null }, { name: 'C', photoKey: 'items/p/c.webp' }],
    });
  });

  it('carries the first three items for the shop pill, in position order, photo or not', async () => {
    expect((await getPublicPage('sq-order'))?.shop?.photos).toEqual([
      { name: 'First', photoKey: 'items/p/first.webp' },
      { name: 'Second', photoKey: 'items/p/second.webp' },
    ]);
    expect((await getPublicPage('sq-many'))?.shop?.photos.map((p) => p.name)).toEqual(['M1', 'M2', 'M3']);
  });

  it('takes the photo of the first item in position order', async () => {
    expect((await getPublicPage('sq-order'))?.shop?.photoKey).toBe('items/p/first.webp');
  });

  it('is null while the shop is closed, and on a personal page', async () => {
    expect((await getPublicPage('sq-closed'))?.shop).toBeNull();
    expect((await getPublicPage('sq-personal'))?.shop).toBeNull();
  });
});

describe('what the page needs to say the next pickup day and price the basket', () => {
  it('carries the pickup terms, whether orders can be taken, and the priced shelf', async () => {
    const ordering = (await getPublicPage('sq-open'))?.shopOrdering;
    expect(ordering).toMatchObject({ pickupEnabled: true, deliveryMode: 'NONE', closedDays: [0, 3], canTakeOrders: true });
    expect(typeof ordering?.minNoticeDays).toBe('number');
    expect(ordering?.items.map((i) => [i.name, i.priceCents])).toEqual([['A', 1000], ['C', null]]);
    expect(ordering?.items[1]?.options.map((o) => [o.label, o.priceCents])).toEqual([['1kg', 9500], ['2kg', 17000]]);
  });

  it('is null while the shop is closed', async () => {
    expect((await getPublicPage('sq-closed'))?.shopOrdering).toBeNull();
  });
});

describe('getOwnerStore', () => {
  it('orders items by position', async () => {
    const store = await getOwnerStore(orderAccountId);
    expect(store?.items.map((item) => item.name)).toEqual(['First', 'Second']);
  });

  it('returns every item, unavailable ones included, with the settings', async () => {
    const store = await getOwnerStore(openAccountId);
    expect(store?.items.map((item) => [item.name, item.available])).toEqual([['A', true], ['B', false], ['C', true]]);
    expect(store?.settings).toMatchObject({ enabled: true, shopDescription: 'Homemade cakes, baked fresh.', pickupEnabled: true, paymentQrKey: 'qr/p/x.png', tileSize: null });
  });

  it('carries slug, category, tag and the halal switch for the editor', async () => {
    const store = await getOwnerStore(openAccountId);
    expect(store?.items[0]).toMatchObject({ slug: 'a', category: 'Cakes', tag: 'New' });
    expect(store?.settings.shopHalal).toBe(false);
  });

  it('carries the closed days and the delivery note', async () => {
    expect((await getOwnerStore(openAccountId))?.settings).toMatchObject({ closedDays: [0, 3], deliveryNote: 'Around Shah Alam' });
  });

  it('carries per digital item its files, codes left and sessions with seats left, and no key or code', async () => {
    const store = await getOwnerStore(digitalAccountId);
    const [book, codes, session, cake] = store?.items ?? [];
    expect(book).toMatchObject({ kind: 'DIGITAL', delivery: 'FILES', files: [{ name: 'one.pdf', sizeBytes: 10 }, { name: 'two.pdf', sizeBytes: 20 }], codesLeft: 0, sessions: [] });
    expect(codes).toMatchObject({ delivery: 'CODES', codesLeft: 3, files: [] });
    expect(session).toMatchObject({ delivery: 'SESSION', sessionMinutes: 90, sessionPlace: 'ONLINE', sessionWhere: 'https://meet.example.com/x' });
    expect(session?.sessions.map((s) => [s.seats, s.booked, s.seatsLeft])).toEqual([[12, 0, 12], [5, 0, 5]]);
    // Rows left from before the item went physical are kept but not offered.
    expect(cake).toMatchObject({ kind: 'PHYSICAL', delivery: null, files: [], codesLeft: 0, sessions: [] });
    const json = JSON.stringify(store);
    expect(json).not.toContain('digital/p/i');
    expect(json).not.toContain('AAA');
  });

  it('counts a booking against the seats and a given code out of the codes left', async () => {
    const page = await write.page.findFirstOrThrow({ where: { accountId: digitalAccountId }, select: { id: true } });
    const items = await write.item.findMany({ where: { pageId: page.id, slug: { in: ['codes', 'class'] } }, select: { id: true, slug: true, sessions: { select: { id: true, seats: true } } } });
    const codesItem = items.find((i) => i.slug === 'codes');
    const classItem = items.find((i) => i.slug === 'class');
    const order = await write.order.create({
      data: { pageId: page.id, number: 1, code: 'ABCD', tokenHash: 'sq-digital-hash', customerName: 'A', phone: '+60123456789', itemsCents: 1, deliveryCents: 0, totalCents: 1, lines: { create: [{ itemId: classItem?.id, itemName: 'x', unitPriceCents: 1, quantity: 3, position: 0 }, { itemId: codesItem?.id, itemName: 'y', unitPriceCents: 1, quantity: 1, position: 1 }] } },
      select: { lines: { orderBy: { position: 'asc' }, select: { id: true } } },
    });
    const twelve = classItem?.sessions.find((s) => s.seats === 12);
    await write.sessionBooking.create({ data: { sessionId: twelve?.id ?? '', orderLineId: order.lines[0]?.id ?? '', seats: 3 } });
    await write.itemCode.updateMany({ where: { itemId: codesItem?.id, code: 'AAA' }, data: { orderLineId: order.lines[1]?.id } });
    const store = await getOwnerStore(digitalAccountId);
    expect(store?.items[1]?.codesLeft).toBe(2);
    expect(store?.items[2]?.sessions.map((s) => [s.seats, s.booked, s.seatsLeft])).toEqual([[12, 3, 9], [5, 0, 5]]);
  });

  it('says whether CHIP is connected, and nothing about the key', async () => {
    const store = await getOwnerStore(chipAccountId);
    expect(store?.chip).toEqual({ connected: true, brandName: 'Kek Lina Bakes', methods: ['fpx', 'visa'], checkedAt: CHECKED, isTest: false });
    expect(JSON.stringify(store)).not.toContain('sealed-box');

    expect((await getOwnerStore(openAccountId))?.chip).toEqual({ connected: false, brandName: null, methods: [], checkedAt: null, isTest: false });
  });

  it('cannot read the sealed key at all, as the read-only role', async () => {
    await expect(prismaRead.shopPaymentAccount.findMany({ select: { secretKeyCiphertext: true } })).rejects.toThrow(/permission denied/);
    await expect(prismaRead.shopPaymentAccount.findMany({ select: { pageId: true, brandName: true } })).resolves.toBeDefined();
  });
});
