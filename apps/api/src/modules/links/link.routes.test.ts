import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { LABEL_MAX, MAX_LINKS } from '@curios/core/bento';
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

    const res = await call(owner.cookie, 'PUT', '/links/order', { ids: [ids[2], ids[0], ids[1]] });

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

    expect((await call(owner.cookie, 'PUT', '/links/order', { ids: [b, 'shop', a] })).statusCode).toBe(200);
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
    await call(owner.cookie, 'PUT', '/links/order', { ids: [a, b, 'shop'] });
    await call(owner.cookie, 'DELETE', `/links/${b}`);
    expect((await call(owner.cookie, 'PUT', '/links/order', { ids: ['shop', a] })).statusCode).toBe(200);
  });
});
