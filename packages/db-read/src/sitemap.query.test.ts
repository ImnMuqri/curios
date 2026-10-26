import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getSitemapPages } from './sitemap.query.js';

const write = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });
const accounts: string[] = [];

async function aPage(extra: Record<string, unknown>): Promise<{ id: string; handle: string }> {
  const slug = `sm${randomUUID().slice(0, 8)}`;
  const account = await write.account.create({
    data: { email: `${slug}@example.com`, pages: { create: { handle: slug, skeleton: slug, displayName: 'S', published: true, ...extra } } },
    select: { id: true, pages: { select: { id: true, handle: true } } },
  });
  accounts.push(account.id);
  return account.pages[0]!;
}

const aTopic = (pageId: string, extra: Record<string, unknown>) =>
  write.topic.create({ data: { pageId, title: `t${randomUUID().slice(0, 6)}`, askCount: 1, ...extra } });

let shop = { id: '', handle: '' };
let business = { id: '', handle: '' };
let opted = { id: '', handle: '' };
const hidden: string[] = [];

beforeAll(async () => {
  shop = await aPage({ mode: 'BUSINESS', storeEnabled: true });
  await aTopic(shop.id, { faqSlug: 'boleh-hantar', answer: 'Ya, ke Klang.', askCount: 5 });
  await aTopic(shop.id, { faqSlug: 'halal', answer: 'Ya.', askCount: 9 });
  await aTopic(shop.id, { faqSlug: 'unanswered', answer: null });
  await aTopic(shop.id, { faqSlug: 'withdrawn', answer: 'No.', faqSuppressed: true });
  await aTopic(shop.id, { faqSlug: null, answer: 'Not yet earned a URL.' });
  business = await aPage({ mode: 'BUSINESS', storeEnabled: false });
  opted = await aPage({ mode: 'PERSONAL', allowSearchIndexing: true });
  await aTopic(opted.id, { faqSlug: 'personal-faq', answer: 'Personal pages have no FAQ route.' });
  hidden.push((await aPage({ mode: 'PERSONAL', allowSearchIndexing: false })).handle);
  hidden.push((await aPage({ mode: 'BUSINESS', published: false })).handle);
  hidden.push((await aPage({ mode: 'BUSINESS', suspendedAt: new Date() })).handle);
});

afterAll(async () => {
  await write.account.deleteMany({ where: { id: { in: accounts } } });
  await write.$disconnect();
});

describe('getSitemapPages', () => {
  it('lists a live business page with its open shop and its answered FAQ entries, most asked first', async () => {
    const found = (await getSitemapPages()).find((p) => p.handle === shop.handle);
    expect(found).toEqual({ handle: shop.handle, shop: true, faqSlugs: ['halal', 'boleh-hantar'] });
  });

  it('lists a business page whose shop is closed without the shop', async () => {
    expect((await getSitemapPages()).find((p) => p.handle === business.handle)).toEqual({ handle: business.handle, shop: false, faqSlugs: [] });
  });

  it('lists a personal page that opted in, with no FAQ or shop, since those routes are business-only', async () => {
    expect((await getSitemapPages()).find((p) => p.handle === opted.handle)).toEqual({ handle: opted.handle, shop: false, faqSlugs: [] });
  });

  it('leaves out a personal page that did not opt in, an unpublished page and a suspended one', async () => {
    const handles = (await getSitemapPages()).map((p) => p.handle);
    for (const handle of hidden) expect(handles).not.toContain(handle);
  });
});
