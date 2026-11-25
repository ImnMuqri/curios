import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { LABEL_MAX, MAX_LINKS, pageEntries } from '@curios/core/bento';
import { LinkLimitError } from './link.service.js';
import { addWidget } from './link.service.js';
import { buildApp } from '../../app.js';
import { createSession, SESSION_COOKIE } from '../auth/session.service.js';

let app: FastifyInstance;
let nth = 0;
const from = () => `203.0.113.${(nth++ % 200) + 1}`;

// The short-link resolver is injected; no test touches the network.
let shortAnswer: string | null = null;
const resolveStub = async () => shortAnswer;

beforeAll(async () => {
  app = await buildApp({ links: { resolve: resolveStub } });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

async function anOwner() {
  const slug = randomUUID().slice(0, 8);
  const account = await app.prisma.account.create({
    data: {
      email: `links-${randomUUID()}@example.com`,
      emailVerifiedAt: new Date(),
      pages: { create: { handle: `ln-${slug}`, skeleton: `ln-${slug}`, displayName: 'Iman' } },
    },
    select: { id: true, pages: { select: { id: true } } },
  });
  const { value } = await createSession(app.prisma, account.id);
  return { cookie: value, pageId: account.pages[0]?.id ?? '' };
}

/** No page claimed yet -- every links route shares pageIdFor, which must refuse each of them. */
async function anOwnerWithNoPage() {
  const account = await app.prisma.account.create({
    data: { email: `links-nopage-${randomUUID()}@example.com`, emailVerifiedAt: new Date() },
    select: { id: true },
  });
  return (await createSession(app.prisma, account.id)).value;
}

const call = (cookie: string, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url, remoteAddress: from(), cookies: { [SESSION_COOKIE]: cookie }, ...(payload ? { payload } : {}) });

const labels = async (cookie: string) =>
  (await call(cookie, 'GET', '/links')).json<{ links: { label: string }[] }>().links.map((l) => l.label);

describe('POST /links', () => {
  it('adds a link, normalising its address, at the end of the list', async () => {
    const owner = await anOwner();
    await call(owner.cookie, 'POST', '/links', { label: 'Portfolio', url: 'iman.dev' });

    const res = await call(owner.cookie, 'POST', '/links', { label: '  WhatsApp  ', url: ' wa.me/60123 ' });

    expect(res.statusCode).toBe(201);
    expect(res.json().link).toMatchObject({ label: 'WhatsApp', url: 'https://wa.me/60123', size: null });
    expect(await labels(owner.cookie)).toEqual(['Portfolio', 'WhatsApp']);
  });

  it('refuses a dangerous address with its own code', async () => {
    const owner = await anOwner();
    const res = await call(owner.cookie, 'POST', '/links', { label: 'x', url: 'javascript:alert(1)' });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_LINK');
  });

  it('refuses an empty or over-long label', async () => {
    const owner = await anOwner();
    for (const label of ['   ', 'a'.repeat(LABEL_MAX + 1)]) {
      const res = await call(owner.cookie, 'POST', '/links', { label, url: 'iman.dev' });
      expect(res.json().error.code).toBe('INVALID_LINK');
    }
  });

  // Review Focus 3: the limit is characters, not UTF-16 units.
  it('accepts a label of LABEL_MAX emoji', async () => {
    const owner = await anOwner();
    const res = await call(owner.cookie, 'POST', '/links', { label: '🎂'.repeat(LABEL_MAX), url: 'iman.dev' });
    expect(res.statusCode).toBe(201);
  });

  it('stops at MAX_LINKS', async () => {
    const owner = await anOwner();
    await app.prisma.link.createMany({
      data: Array.from({ length: MAX_LINKS }, (_unused, position) => ({
        pageId: owner.pageId,
        label: `L${position}`,
        url: 'https://iman.dev',
        position,
      })),
    });

    const res = await call(owner.cookie, 'POST', '/links', { label: 'One more', url: 'iman.dev' });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('LINK_LIMIT');
  });
});

describe('PATCH /links/:id', () => {
  it('changes the label, address and size, and a null size means automatic again', async () => {
    const owner = await anOwner();
    const { link } = (await call(owner.cookie, 'POST', '/links', { label: 'A', url: 'a.com' })).json();

    const big = await call(owner.cookie, 'PATCH', `/links/${link.id}`, { label: 'B', url: 'b.com', size: 'BIG' });
    expect(big.json().link).toMatchObject({ label: 'B', url: 'https://b.com', size: 'BIG' });

    const auto = await call(owner.cookie, 'PATCH', `/links/${link.id}`, { size: null });
    expect(auto.json().link.size).toBeNull();
  });

  it("answers 404 for another owner's link, and changes nothing", async () => {
    const owner = await anOwner();
    const stranger = await anOwner();
    const { link } = (await call(owner.cookie, 'POST', '/links', { label: 'Mine', url: 'a.com' })).json();

    const res = await call(stranger.cookie, 'PATCH', `/links/${link.id}`, { label: 'Stolen' });

    expect(res.statusCode).toBe(404);
    expect(await labels(owner.cookie)).toEqual(['Mine']);
  });
});

describe('DELETE /links/:id', () => {
  it('removes the link and closes up the order', async () => {
    const owner = await anOwner();
    const ids: string[] = [];
    for (const label of ['A', 'B', 'C']) {
      ids.push((await call(owner.cookie, 'POST', '/links', { label, url: 'a.com' })).json().link.id);
    }

    await call(owner.cookie, 'DELETE', `/links/${ids[0]}`);

    const rows = await app.prisma.link.findMany({ where: { pageId: owner.pageId }, orderBy: { position: 'asc' } });
    expect(rows.map((r) => [r.label, r.position])).toEqual([['B', 0], ['C', 1]]);
  });

  // Not in the brief's table, but the service scopes this delete on pageId same
  // as the PATCH one above; caught it by mutation -- dropping that scope left
  // the whole suite green, so it needed its own test.
  it("answers 404 for another owner's link, and deletes nothing", async () => {
    const owner = await anOwner();
    const stranger = await anOwner();
    const { link } = (await call(owner.cookie, 'POST', '/links', { label: 'Mine', url: 'a.com' })).json();

    const res = await call(stranger.cookie, 'DELETE', `/links/${link.id}`);

    expect(res.statusCode).toBe(404);
    expect(await labels(owner.cookie)).toEqual(['Mine']);
  });
});

describe('PUT /links/order', () => {
  it('applies a new order', async () => {
    const owner = await anOwner();
    const ids: string[] = [];
    for (const label of ['A', 'B', 'C']) {
      ids.push((await call(owner.cookie, 'POST', '/links', { label, url: 'a.com' })).json().link.id);
    }

    const res = await call(owner.cookie, 'PUT', '/links/order', { ids: [ids[2], ids[0], ids[1], 'faq'] });

    expect(res.statusCode).toBe(200);
    expect(await labels(owner.cookie)).toEqual(['C', 'A', 'B']);
  });

  // Review Focus 1: a second tab reordering a list that has since changed.
  it('refuses a stale set and changes nothing', async () => {
    const owner = await anOwner();
    const a = (await call(owner.cookie, 'POST', '/links', { label: 'A', url: 'a.com' })).json().link.id;
    const b = (await call(owner.cookie, 'POST', '/links', { label: 'B', url: 'a.com' })).json().link.id;
    await call(owner.cookie, 'POST', '/links', { label: 'C', url: 'a.com' }); // added in the other tab

    const res = await call(owner.cookie, 'PUT', '/links/order', { ids: [b, a] });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('LINK_ORDER_STALE');
    expect(await labels(owner.cookie)).toEqual(['A', 'B', 'C']);
  });

  it("refuses an order that includes another owner's link", async () => {
    const owner = await anOwner();
    const stranger = await anOwner();
    const mine = (await call(owner.cookie, 'POST', '/links', { label: 'Mine', url: 'a.com' })).json().link.id;
    const theirs = (await call(stranger.cookie, 'POST', '/links', { label: 'Theirs', url: 'a.com' })).json().link.id;

    const res = await call(owner.cookie, 'PUT', '/links/order', { ids: [theirs, mine] });

    expect(res.statusCode).toBe(409);
  });

  it('refuses a repeated id', async () => {
    const owner = await anOwner();
    const a = (await call(owner.cookie, 'POST', '/links', { label: 'A', url: 'a.com' })).json().link.id;
    await call(owner.cookie, 'POST', '/links', { label: 'B', url: 'a.com' });

    const res = await call(owner.cookie, 'PUT', '/links/order', { ids: [a, a] });

    expect(res.statusCode).toBe(409);
  });

  // Not in the brief's table. The test above sends only 2 ids for a page that
  // has exactly 2 links, so the "wrong count" check (`sent.size !== known.size`)
  // already refuses it on its own -- the dedicated "no repeats" check
  // (`sent.size !== ids.length`) is never the reason. Caught by mutation:
  // deleting that clause left the whole suite green. Here every known id is
  // still present (a and b both appear), so only a genuine no-repeats check
  // catches `a` being sent twice.
  it('refuses a repeated id even when every link is still named once', async () => {
    const owner = await anOwner();
    const a = (await call(owner.cookie, 'POST', '/links', { label: 'A', url: 'a.com' })).json().link.id;
    const b = (await call(owner.cookie, 'POST', '/links', { label: 'B', url: 'a.com' })).json().link.id;

    const res = await call(owner.cookie, 'PUT', '/links/order', { ids: [a, b, a] });

    expect(res.statusCode).toBe(409);
    expect(await labels(owner.cookie)).toEqual(['A', 'B']);
  });
});

describe('NO_PAGE', () => {
  // Not in the brief's table. Every route below shares pageIdFor; caught by
  // mutation -- deleting its throw left the whole 12-test suite green, because
  // anOwner() always claims a page first, so nothing ever exercised this path.
  it('answers 404 for an owner who has not claimed a page yet', async () => {
    const cookie = await anOwnerWithNoPage();

    expect((await call(cookie, 'GET', '/links')).statusCode).toBe(404);
    expect((await call(cookie, 'POST', '/links', { label: 'A', url: 'a.com' })).statusCode).toBe(404);
    expect((await call(cookie, 'PATCH', '/links/x', { label: 'A' })).statusCode).toBe(404);
    expect((await call(cookie, 'DELETE', '/links/x')).statusCode).toBe(404);
    expect((await call(cookie, 'PUT', '/links/order', { ids: [] })).statusCode).toBe(404);

    const res = await call(cookie, 'GET', '/links');
    expect(res.json().error.code).toBe('NO_PAGE');
  });
});

describe('PUT /links/order with the shop tile', () => {
  async function openShop(pageId: string) {
    await app.prisma.page.update({ where: { id: pageId }, data: { storeEnabled: true, pickupEnabled: true, paymentQrKey: 'qr/x.png' } });
  }

  it('places the shop tile among the links', async () => {
    const owner = await anOwner();
    const a = (await call(owner.cookie, 'POST', '/links', { label: 'A', url: 'a.com' })).json().link.id as string;
    const b = (await call(owner.cookie, 'POST', '/links', { label: 'B', url: 'b.com' })).json().link.id as string;
    await openShop(owner.pageId);

    expect((await call(owner.cookie, 'PUT', '/links/order', { ids: [b, 'shop', a, 'faq'] })).statusCode).toBe(200);
    expect(await labels(owner.cookie)).toEqual(['B', 'A']);
    expect((await app.prisma.page.findUniqueOrThrow({ where: { id: owner.pageId } })).shopTilePosition).toBe(1);
  });

  it('refuses the shop tile while the shop is closed, and its absence while open', async () => {
    const owner = await anOwner();
    const a = (await call(owner.cookie, 'POST', '/links', { label: 'A', url: 'a.com' })).json().link.id as string;
    expect((await call(owner.cookie, 'PUT', '/links/order', { ids: [a, 'shop'] })).json().error.code).toBe('LINK_ORDER_STALE');
    await openShop(owner.pageId);
    expect((await call(owner.cookie, 'PUT', '/links/order', { ids: [a] })).json().error.code).toBe('LINK_ORDER_STALE');
    expect((await call(owner.cookie, 'PUT', '/links/order', { ids: ['shop', a, 'shop'] })).json().error.code).toBe('LINK_ORDER_STALE');
  });

  // Review Focus 1.
  it('still reorders after links were removed from under a last-placed tile', async () => {
    const owner = await anOwner();
    const a = (await call(owner.cookie, 'POST', '/links', { label: 'A', url: 'a.com' })).json().link.id as string;
    const b = (await call(owner.cookie, 'POST', '/links', { label: 'B', url: 'b.com' })).json().link.id as string;
    await openShop(owner.pageId);
    await call(owner.cookie, 'PUT', '/links/order', { ids: [a, b, 'shop', 'faq'] });
    await call(owner.cookie, 'DELETE', `/links/${b}`);
    expect((await call(owner.cookie, 'PUT', '/links/order', { ids: ['shop', a, 'faq'] })).statusCode).toBe(200);
  });
});

describe('PUT /links/order with the FAQ block', () => {
  const setup = async (mode: 'BUSINESS' | 'PERSONAL') => {
    const owner = await anOwner();
    await app.prisma.page.update({ where: { id: owner.pageId }, data: { mode } });
    const a = (await call(owner.cookie, 'POST', '/links', { label: 'A', url: 'a.com' })).json().link.id as string;
    const b = (await call(owner.cookie, 'POST', '/links', { label: 'B', url: 'b.com' })).json().link.id as string;
    return { owner, a, b };
  };
  const faqAt = async (pageId: string) => (await app.prisma.page.findUniqueOrThrow({ where: { id: pageId } })).faqPosition;

  it('stores the FAQ index on a business page', async () => {
    const { owner, a, b } = await setup('BUSINESS');
    expect((await call(owner.cookie, 'PUT', '/links/order', { ids: [b, 'faq', a] })).statusCode).toBe(200);
    expect(await labels(owner.cookie)).toEqual(['B', 'A']);
    expect(await faqAt(owner.pageId)).toBe(1);
  });

  it('refuses a business list without faq, and changes nothing', async () => {
    const { owner, a, b } = await setup('BUSINESS');
    await call(owner.cookie, 'PUT', '/links/order', { ids: ['faq', a, b] });
    expect((await call(owner.cookie, 'PUT', '/links/order', { ids: [b, a] })).json().error.code).toBe('LINK_ORDER_STALE');
    expect(await labels(owner.cookie)).toEqual(['A', 'B']);
    expect(await faqAt(owner.pageId)).toBe(0);
  });

  it('refuses faq on a personal page, and twice on a business one', async () => {
    const p = await setup('PERSONAL');
    expect((await call(p.owner.cookie, 'PUT', '/links/order', { ids: [p.a, 'faq', p.b] })).json().error.code).toBe('LINK_ORDER_STALE');
    expect((await call(p.owner.cookie, 'PUT', '/links/order', { ids: [p.a, p.b] })).statusCode).toBe(200);
    expect(await faqAt(p.owner.pageId)).toBeNull();
    const q = await setup('BUSINESS');
    expect((await call(q.owner.cookie, 'PUT', '/links/order', { ids: ['faq', q.a, 'faq', q.b] })).json().error.code).toBe('LINK_ORDER_STALE');
  });

  it('keeps the FAQ last when links are added after a drag that left it last', async () => {
    const { owner, a, b } = await setup('BUSINESS');
    expect((await call(owner.cookie, 'PUT', '/links/order', { ids: [b, a, 'faq'] })).statusCode).toBe(200);
    expect(await faqAt(owner.pageId)).toBeNull();
    await call(owner.cookie, 'POST', '/links', { label: 'C', url: 'c.com' });
    const page = await app.prisma.page.findUniqueOrThrow({ where: { id: owner.pageId } });
    const links = await app.prisma.link.findMany({ where: { pageId: owner.pageId }, orderBy: { position: 'asc' }, select: { id: true, label: true, size: true } });
    const order = pageEntries(links, { position: page.shopTilePosition, size: null }, { position: page.faqPosition }).map((e) => (e.kind === 'link' ? e.link.label : e.id)).filter((x) => x !== 'shop');
    expect(order).toEqual(['B', 'A', 'C', 'faq']);
  });

  it('keeps shop and faq positions as sent', async () => {
    const { owner, a, b } = await setup('BUSINESS');
    await app.prisma.page.update({ where: { id: owner.pageId }, data: { storeEnabled: true, pickupEnabled: true, paymentQrKey: 'qr/x.png' } });
    expect((await call(owner.cookie, 'PUT', '/links/order', { ids: ['faq', a, 'shop', b] })).statusCode).toBe(200);
    const page = await app.prisma.page.findUniqueOrThrow({ where: { id: owner.pageId } });
    expect([page.faqPosition, page.shopTilePosition]).toEqual([0, 2]);
  });
});

describe('DELETE /links/:id with the shop tile and the FAQ block', () => {
  async function arranged(order: string[]) {
    const owner = await anOwner();
    await app.prisma.page.update({
      where: { id: owner.pageId },
      data: { mode: 'BUSINESS', storeEnabled: true, pickupEnabled: true, paymentQrKey: 'qr/x.png' },
    });
    const a = (await call(owner.cookie, 'POST', '/links', { label: 'A', url: 'a.com' })).json().link.id as string;
    const b = (await call(owner.cookie, 'POST', '/links', { label: 'B', url: 'b.com' })).json().link.id as string;
    const ids = order.map((x) => (x === 'a' ? a : x === 'b' ? b : x));
    expect((await call(owner.cookie, 'PUT', '/links/order', { ids })).statusCode).toBe(200);
    return { owner, a, b };
  }
  async function rebuilt(owner: { cookie: string; pageId: string }) {
    const page = await app.prisma.page.findUniqueOrThrow({ where: { id: owner.pageId } });
    const links = await app.prisma.link.findMany({ where: { pageId: owner.pageId }, orderBy: { position: 'asc' }, select: { id: true, label: true, size: true } });
    return pageEntries(links, { position: page.shopTilePosition, size: null }, { position: page.faqPosition }).map((e) =>
      e.kind === 'link' ? e.link.label : e.id,
    );
  }

  it('[shop, a, faq, b] minus b is [shop, a, faq]', async () => {
    const { owner, b } = await arranged(['shop', 'a', 'faq', 'b']);
    await call(owner.cookie, 'DELETE', `/links/${b}`);
    expect(await rebuilt(owner)).toEqual(['shop', 'A', 'faq']);
  });

  it('[faq, a, shop, b] minus b is [faq, a, shop]', async () => {
    const { owner, b } = await arranged(['faq', 'a', 'shop', 'b']);
    await call(owner.cookie, 'DELETE', `/links/${b}`);
    expect(await rebuilt(owner)).toEqual(['faq', 'A', 'shop']);
  });

  it('[a, shop, faq, b] minus a is [shop, faq, b]', async () => {
    const { owner, a } = await arranged(['a', 'shop', 'faq', 'b']);
    await call(owner.cookie, 'DELETE', `/links/${a}`);
    expect(await rebuilt(owner)).toEqual(['shop', 'faq', 'B']);
  });
});

describe('DELETE /links/:id with the shop tile', () => {
  async function shopAt(position: number, linkCount: number, open = true) {
    const owner = await anOwner();
    const ids: string[] = [];
    for (const label of ['A', 'B', 'C'].slice(0, linkCount)) {
      ids.push((await call(owner.cookie, 'POST', '/links', { label, url: 'a.com' })).json().link.id);
    }
    await app.prisma.page.update({
      where: { id: owner.pageId },
      data: { shopTilePosition: position, ...(open ? { storeEnabled: true, pickupEnabled: true, paymentQrKey: 'qr/x.png' } : {}) },
    });
    return { owner, ids };
  }
  const tileAt = async (pageId: string) => (await app.prisma.page.findUniqueOrThrow({ where: { id: pageId } })).shopTilePosition;

  it('keeps the tile beside the same neighbour when a link above it is removed', async () => {
    const { owner, ids } = await shopAt(1, 3);
    await call(owner.cookie, 'DELETE', `/links/${ids[0]}`);
    expect(await tileAt(owner.pageId)).toBe(0);
  });

  it('leaves the tile where it is when a link after it is removed', async () => {
    const { owner, ids } = await shopAt(1, 3);
    await call(owner.cookie, 'DELETE', `/links/${ids[2]}`);
    expect(await tileAt(owner.pageId)).toBe(1);
  });

  it('leaves the stored position alone while the shop is closed', async () => {
    const { owner, ids } = await shopAt(2, 3, false);
    await call(owner.cookie, 'DELETE', `/links/${ids[0]}`);
    expect(await tileAt(owner.pageId)).toBe(2);
  });
});

describe('POST /links joins the end of the links', () => {
  async function arrange(labels: string[], shopAt: number | null, faqAt: number | null) {
    const owner = await anOwner();
    for (const label of labels) await call(owner.cookie, 'POST', '/links', { label, url: 'a.com' });
    await app.prisma.page.update({
      where: { id: owner.pageId },
      data: {
        faqPosition: faqAt,
        ...(shopAt === null ? {} : { storeEnabled: true, pickupEnabled: true, paymentQrKey: 'qr/x.png', shopTilePosition: shopAt }),
      },
    });
    return owner;
  }
  async function order(owner: { pageId: string }) {
    const page = await app.prisma.page.findUniqueOrThrow({ where: { id: owner.pageId } });
    const links = await app.prisma.link.findMany({ where: { pageId: owner.pageId }, orderBy: { position: 'asc' }, select: { id: true, label: true, size: true } });
    return pageEntries(links, page.storeEnabled ? { position: page.shopTilePosition, size: null } : null, { position: page.faqPosition }).map((e) =>
      e.kind === 'link' ? e.link.label : e.id,
    );
  }

  it('[A, B, shop, faq] + C is [A, B, C, shop, faq]', async () => {
    const owner = await arrange(['A', 'B'], 2, null);
    await call(owner.cookie, 'POST', '/links', { label: 'C', url: 'c.com' });
    expect(await order(owner)).toEqual(['A', 'B', 'C', 'shop', 'faq']);
  });

  it('[A, shop, B] + C keeps the shop between A and B', async () => {
    const owner = await arrange(['A', 'B'], 1, null);
    await call(owner.cookie, 'POST', '/links', { label: 'C', url: 'c.com' });
    expect(await order(owner)).toEqual(['A', 'shop', 'B', 'C', 'faq']);
  });

  it('[shop] + C with no links yet is [C, shop]', async () => {
    const owner = await arrange([], 0, null);
    await call(owner.cookie, 'POST', '/links', { label: 'C', url: 'c.com' });
    expect(await order(owner)).toEqual(['C', 'shop', 'faq']);
  });

  it('moves a FAQ that sits after the links, and one before the last link stays', async () => {
    const after = await arrange(['A', 'B'], null, 2);
    await call(after.cookie, 'POST', '/links', { label: 'C', url: 'c.com' });
    expect(await order(after)).toEqual(['A', 'B', 'C', 'faq']);
    const before = await arrange(['A', 'B'], null, 1);
    await call(before.cookie, 'POST', '/links', { label: 'C', url: 'c.com' });
    expect(await order(before)).toEqual(['A', 'faq', 'B', 'C']);
  });

  it('leaves a closed shop alone and a null FAQ last', async () => {
    const owner = await arrange(['A', 'B'], null, null);
    await app.prisma.page.update({ where: { id: owner.pageId }, data: { shopTilePosition: 2 } });
    await call(owner.cookie, 'POST', '/links', { label: 'C', url: 'c.com' });
    expect((await app.prisma.page.findUniqueOrThrow({ where: { id: owner.pageId } })).shopTilePosition).toBe(2);
    expect(await order(owner)).toEqual(['A', 'B', 'C', 'faq']);
  });

  it('a widget joins the end of the links too', async () => {
    const owner = await arrange(['A', 'B'], 2, 3);
    await call(owner.cookie, 'POST', '/links/widgets', { url: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC', label: 'W' });
    expect(await order(owner)).toEqual(['A', 'B', 'W', 'shop', 'faq']);
  });
});

describe('POST /links/widgets', () => {
  const spotify = 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC';

  it('saves a Spotify link as a widget, naming it after the provider when no label is given', async () => {
    const owner = await anOwner();
    const res = await call(owner.cookie, 'POST', '/links/widgets', { url: spotify, label: null });

    expect(res.statusCode).toBe(201);
    expect(res.json().link).toMatchObject({
      label: 'Spotify',
      url: spotify,
      kind: 'WIDGET',
      provider: 'SPOTIFY',
      embedRef: 'track/4uLU6hMCjMI75M1A2tKUQC',
    });
  });

  it('keeps a given label, and a plain link stays a LINK with no provider', async () => {
    const owner = await anOwner();
    const w = await call(owner.cookie, 'POST', '/links/widgets', { url: spotify, label: ' My song ' });
    expect(w.json().link.label).toBe('My song');
    const l = await call(owner.cookie, 'POST', '/links', { label: 'A', url: 'a.com' });
    expect(l.json().link).toMatchObject({ kind: 'LINK', provider: null, embedRef: null });
  });

  it('refuses a link that cannot be embedded, with its code, and saves nothing', async () => {
    const owner = await anOwner();
    const res = await call(owner.cookie, 'POST', '/links/widgets', { url: 'https://example.com/x', label: null });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_WIDGET');
    expect(await app.prisma.link.count({ where: { pageId: owner.pageId } })).toBe(0);
  });

  it('counts widgets toward MAX_LINKS', async () => {
    const owner = await anOwner();
    await app.prisma.link.createMany({
      data: Array.from({ length: MAX_LINKS }, (_unused, position) => ({
        pageId: owner.pageId,
        label: `L${position}`,
        url: 'https://iman.dev',
        position,
      })),
    });
    const res = await call(owner.cookie, 'POST', '/links/widgets', { url: spotify, label: null });
    expect(res.json().error.code).toBe('LINK_LIMIT');
  });

  it('saves a short link whose resolver answer is a Spotify URL', async () => {
    const owner = await anOwner();
    shortAnswer = spotify;
    const res = await call(owner.cookie, 'POST', '/links/widgets', { url: 'https://spotify.link/abc', label: null });
    expect(res.statusCode).toBe(201);
    expect(res.json().link).toMatchObject({ provider: 'SPOTIFY', embedRef: 'track/4uLU6hMCjMI75M1A2tKUQC', url: 'https://spotify.link/abc' });
  });

  // Review Focus 2: the redirect must land on the provider the short host implied.
  it('refuses a short link that redirects somewhere else, and saves nothing', async () => {
    const owner = await anOwner();
    for (const answer of ['https://evil.example/x', 'https://youtu.be/dQw4w9WgXcQ', null]) {
      shortAnswer = answer;
      const res = await call(owner.cookie, 'POST', '/links/widgets', { url: 'https://spotify.link/abc', label: null });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('INVALID_WIDGET');
    }
    expect(await app.prisma.link.count({ where: { pageId: owner.pageId } })).toBe(0);
  });

  it('refuses the 31st item through the service as LinkLimitError', async () => {
    const owner = await anOwner();
    await app.prisma.link.createMany({
      data: Array.from({ length: MAX_LINKS }, (_unused, position) => ({ pageId: owner.pageId, label: `L${position}`, url: 'https://iman.dev', position })),
    });
    const account = await app.prisma.page.findUniqueOrThrow({ where: { id: owner.pageId }, select: { accountId: true } });
    await expect(addWidget(app.prisma, account.accountId, { url: spotify, label: null }, async () => null)).rejects.toBeInstanceOf(LinkLimitError);
  });
});

describe('PATCH /links/:id on a widget', () => {
  const spotify = 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC';

  it('takes the service name when the label is cleared, and a plain link still refuses a blank one', async () => {
    const owner = await anOwner();
    const { link } = (await call(owner.cookie, 'POST', '/links/widgets', { url: spotify, label: 'Mine' })).json();
    const res = await call(owner.cookie, 'PATCH', `/links/${link.id}`, { label: '' });
    expect(res.statusCode).toBe(200);
    expect(res.json().link.label).toBe('Spotify');

    const plain = (await call(owner.cookie, 'POST', '/links', { label: 'A', url: 'a.com' })).json().link;
    expect((await call(owner.cookie, 'PATCH', `/links/${plain.id}`, { label: '  ' })).statusCode).toBe(400);
  });

  it('changes label and size, and re-parses a new url into provider and ref', async () => {
    const owner = await anOwner();
    const { link } = (await call(owner.cookie, 'POST', '/links/widgets', { url: spotify, label: null })).json();

    const res = await call(owner.cookie, 'PATCH', `/links/${link.id}`, {
      label: 'Mine',
      size: 'WIDE',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    });

    expect(res.json().link).toMatchObject({
      label: 'Mine',
      size: 'WIDE',
      kind: 'WIDGET',
      provider: 'YOUTUBE',
      embedRef: 'v/dQw4w9WgXcQ',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    });
  });

  it('refuses an unembeddable new url on a widget and changes nothing', async () => {
    const owner = await anOwner();
    const { link } = (await call(owner.cookie, 'POST', '/links/widgets', { url: spotify, label: null })).json();

    const res = await call(owner.cookie, 'PATCH', `/links/${link.id}`, { url: 'https://example.com/x' });

    expect(res.json().error.code).toBe('INVALID_WIDGET');
    const row = await app.prisma.link.findUniqueOrThrow({ where: { id: link.id } });
    expect(row).toMatchObject({ url: spotify, provider: 'SPOTIFY' });
  });

  it("never gives a plain link a provider when its url changes", async () => {
    const owner = await anOwner();
    const { link } = (await call(owner.cookie, 'POST', '/links', { label: 'A', url: 'a.com' })).json();
    const res = await call(owner.cookie, 'PATCH', `/links/${link.id}`, { url: spotify });
    expect(res.json().link).toMatchObject({ kind: 'LINK', provider: null, embedRef: null });
  });

  it("answers 404 for another owner's widget", async () => {
    const owner = await anOwner();
    const stranger = await anOwner();
    const { link } = (await call(owner.cookie, 'POST', '/links/widgets', { url: spotify, label: null })).json();
    const res = await call(stranger.cookie, 'PATCH', `/links/${link.id}`, { label: 'Stolen', url: spotify });
    expect(res.statusCode).toBe(404);
  });
});
