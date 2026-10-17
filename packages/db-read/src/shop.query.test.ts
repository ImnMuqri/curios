import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getPublicPage } from './page.query.js';
import { getOwnerStore, getPublicShop } from './shop.query.js';

const write = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });
const EMAIL = '@shop-query.example.com';
let openAccountId = '';
let orderAccountId = '';

const shelf = [
  { name: 'A', priceCents: 1000, position: 0, available: true },
  { name: 'B', priceCents: 2000, position: 1, available: false, photoKey: 'items/p/b.webp' },
  {
    name: 'C',
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
  openAccountId = await seed('sq-open', { shopDescription: 'Homemade cakes, baked fresh.' });
  await seed('sq-closed', { storeEnabled: false });
  await seed('sq-personal', { mode: 'PERSONAL' });
  await seed('sq-draft', { published: false });
  // Created in the reverse of their positions, so insertion order cannot pass for position order.
  orderAccountId = await seed('sq-order', {
    items: { create: [
      { name: 'Second', position: 1, available: true, photoKey: 'items/p/second.webp' },
      { name: 'First', position: 0, available: true, photoKey: 'items/p/first.webp' },
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

  // Review Focus 3.
  it('carries the shop description, for above the items', async () => {
    expect((await getPublicShop('sq-open'))?.shopDescription).toBe('Homemade cakes, baked fresh.');
    expect((await getPublicShop('sq-order'))?.shopDescription).toBeNull();
  });

  it('is null for a closed shop, a personal page, and an unpublished page', async () => {
    expect(await getPublicShop('sq-closed')).toBeNull();
    expect(await getPublicShop('sq-personal')).toBeNull();
    expect(await getPublicShop('sq-draft')).toBeNull();
  });
});

describe('the tile on the public page', () => {
  it('counts available items and takes the first available photo', async () => {
    expect((await getPublicPage('sq-open'))?.shop).toEqual({ position: 0, size: null, itemCount: 2, photoKey: 'items/p/c.webp' });
  });

  it('takes the photo of the first item in position order', async () => {
    expect((await getPublicPage('sq-order'))?.shop?.photoKey).toBe('items/p/first.webp');
  });

  it('is null while the shop is closed, and on a personal page', async () => {
    expect((await getPublicPage('sq-closed'))?.shop).toBeNull();
    expect((await getPublicPage('sq-personal'))?.shop).toBeNull();
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
});
