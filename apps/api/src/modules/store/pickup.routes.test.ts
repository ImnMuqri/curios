import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashSessionValue } from '@curios/core';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { createSession, SESSION_COOKIE } from '../auth/session.service.js';

let app: FastifyInstance;
let nth = 0;
const from = () => `198.51.101.${(nth++ % 200) + 1}`;
const accountIds: string[] = [];

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  // Pages, places, windows and orders go with the account.
  await app.prisma.account.deleteMany({ where: { id: { in: accountIds } } });
  await app.close();
});

async function anOwner(options: { pickupEnabled?: boolean } = {}) {
  const handle = `pk-${randomUUID().slice(0, 8)}`;
  const account = await app.prisma.account.create({
    data: {
      email: `pickup-${randomUUID()}@example.com`,
      emailVerifiedAt: new Date(),
      pages: {
        create: {
          handle,
          skeleton: handle,
          displayName: 'Kek Lina',
          mode: 'BUSINESS',
          published: true,
          storeEnabled: true,
          pickupEnabled: options.pickupEnabled ?? false,
        },
      },
    },
    select: { id: true, pages: { select: { id: true } } },
  });
  accountIds.push(account.id);
  return { cookie: (await createSession(app.prisma, account.id)).value, pageId: account.pages[0]?.id ?? '' };
}

const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, cookie?: string, payload?: object) =>
  app.inject({ method, url, remoteAddress: from(), ...(cookie ? { cookies: { [SESSION_COOKIE]: cookie } } : {}), ...(payload ? { payload } : {}) });

const home = { name: 'Home', address: '12 Jalan Mawar, Seksyen 7', mapUrl: null, note: null, anyTime: true, windows: [] };
const morning = { from: 600, to: 720, limit: 5 };
const afternoon = { from: 840, to: 960, limit: null };
const make = async (owner: { cookie: string }, body: object = home) => {
  const res = await call('POST', '/store/pickup-places', owner.cookie, body);
  expect(res.statusCode).toBe(201);
  return res.json().places as { id: string; windows: { id: string }[] }[];
};

const INVALID = (message: string) => ({ error: { code: 'PICKUP_PLACE_INVALID', message } });

describe('owner pickup places', () => {
  it('needs a session', async () => {
    expect((await call('GET', '/store/pickup-places')).statusCode).toBe(401);
  });

  it('creates places and lists them in order, each answer the whole list', async () => {
    const owner = await anOwner();
    expect((await call('GET', '/store/pickup-places', owner.cookie)).json()).toEqual({ places: [] });
    await make(owner);
    const places = await make(owner, { ...home, name: 'Stall', note: ' Ring the bell ', mapUrl: 'https://maps.example.com/x', anyTime: false, windows: [morning, afternoon] });
    expect(places).toHaveLength(2);
    expect((await call('GET', '/store/pickup-places', owner.cookie)).json().places).toEqual(places);
    expect(places[1]).toMatchObject({
      name: 'Stall',
      note: 'Ring the bell',
      mapUrl: 'https://maps.example.com/x',
      anyTime: false,
      windows: [
        { from: 600, to: 720, limit: 5 },
        { from: 840, to: 960, limit: null },
      ],
    });
  });

  it('PUT updates a sent window in place, deletes one not sent, creates one without an id', async () => {
    const owner = await anOwner();
    const [place] = await make(owner, { ...home, anyTime: false, windows: [morning, afternoon] });
    const [keep, drop] = place!.windows as { id: string }[];
    // An order on the window that is about to go.
    const order = await app.prisma.order.create({
      data: {
        pageId: owner.pageId,
        number: 1,
        code: 'PK01',
        tokenHash: hashSessionValue(randomBytes(8).toString('hex')),
        customerName: 'Aisyah',
        phone: '+60123456789',
        method: 'PICKUP',
        day: new Date('2026-12-01T00:00:00Z'),
        itemsCents: 5_000,
        deliveryCents: 0,
        totalCents: 5_000,
        pickupPlaceId: place!.id,
        pickupWindowId: drop!.id,
        pickupFrom: 840,
        pickupTo: 960,
      },
    });

    const res = await call('PUT', `/store/pickup-places/${place!.id}`, owner.cookie, {
      ...home,
      name: 'Home, side gate',
      anyTime: false,
      windows: [{ id: keep!.id, from: 600, to: 660, limit: 3 }, { from: 1000, to: 1100, limit: null }],
    });
    expect(res.statusCode).toBe(200);
    const [after] = res.json().places;
    expect(after.name).toBe('Home, side gate');
    expect(after.windows).toHaveLength(2);
    expect(after.windows[0]).toEqual({ id: keep!.id, from: 600, to: 660, limit: 3 });
    expect(after.windows[1]).toMatchObject({ from: 1000, to: 1100, limit: null });
    expect(after.windows.map((w: { id: string }) => w.id)).not.toContain(drop!.id);

    const orphaned = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(orphaned.pickupWindowId).toBeNull();
    // The snapshot stays.
    expect(orphaned).toMatchObject({ pickupPlaceId: place!.id, pickupFrom: 840, pickupTo: 960 });
  });

  it('refuses a window id that is not this place\'s, and a repeated one', async () => {
    const owner = await anOwner();
    const [a, b] = await (async () => {
      await make(owner, { ...home, anyTime: false, windows: [morning] });
      return make(owner, { ...home, name: 'Other', anyTime: false, windows: [afternoon] });
    })();
    const foreign = b!.windows[0]!.id;
    const msg = 'One of those pickup times is not on this place. Reload and try again.';
    const res = await call('PUT', `/store/pickup-places/${a!.id}`, owner.cookie, { ...home, anyTime: false, windows: [{ id: foreign, ...morning }] });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual(INVALID(msg));
    const own = a!.windows[0]!.id;
    const twice = await call('PUT', `/store/pickup-places/${a!.id}`, owner.cookie, { ...home, anyTime: false, windows: [{ id: own, ...morning }, { id: own, ...afternoon }] });
    expect(twice.json()).toEqual(INVALID(msg));
  });

  it('refuses overlapping windows with the overlap message', async () => {
    const owner = await anOwner();
    const res = await call('POST', '/store/pickup-places', owner.cookie, { ...home, anyTime: false, windows: [{ from: 600, to: 720, limit: null }, { from: 660, to: 780, limit: null }] });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual(INVALID('Two pickup times overlap: 10am–12pm and 11am–1pm.'));
    expect((await call('GET', '/store/pickup-places', owner.cookie)).json().places).toEqual([]);
  });

  it('stores no windows for any time, and drops the ones sent with it', async () => {
    const owner = await anOwner();
    const [place] = await make(owner, { ...home, anyTime: true, windows: [morning] });
    expect(place).toMatchObject({ anyTime: true, windows: [] });
    expect(await app.prisma.pickupWindow.count({ where: { placeId: place!.id } })).toBe(0);
    // Switching a place with times to any time removes them.
    const timed = (await make(owner, { ...home, name: 'Timed', anyTime: false, windows: [morning] })).at(-1);
    const res = await call('PUT', `/store/pickup-places/${timed!.id}`, owner.cookie, { ...home, name: 'Timed', anyTime: true, windows: [] });
    expect(res.json().places[1]).toMatchObject({ anyTime: true, windows: [] });
    expect(await app.prisma.pickupWindow.count({ where: { placeId: timed!.id } })).toBe(0);
  });

  it('refuses set times with no windows', async () => {
    const owner = await anOwner();
    const res = await call('POST', '/store/pickup-places', owner.cookie, { ...home, anyTime: false, windows: [] });
    expect(res.json()).toEqual(INVALID('Add a pickup time, or choose any time that day.'));
  });

  it('stops at 10 places', async () => {
    const owner = await anOwner();
    for (let i = 0; i < 10; i++) await make(owner, { ...home, name: `Place ${i}` });
    const res = await call('POST', '/store/pickup-places', owner.cookie, { ...home, name: 'Eleventh' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: { code: 'PICKUP_PLACES_FULL', message: 'A shop has up to 10 pickup places.' } });
    expect(await app.prisma.pickupPlace.count({ where: { pageId: owner.pageId } })).toBe(10);
  });

  it('will not delete the last place while pickup is on, and will once it is off', async () => {
    const owner = await anOwner({ pickupEnabled: true });
    const [only] = await make(owner);
    const res = await call('DELETE', `/store/pickup-places/${only!.id}`, owner.cookie);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: { code: 'PICKUP_LAST_PLACE', message: 'Pickup needs at least one place. Turn pickup off instead.' } });

    // With a second place the first can go.
    await make(owner, { ...home, name: 'Second' });
    const gone = await call('DELETE', `/store/pickup-places/${only!.id}`, owner.cookie);
    expect(gone.statusCode).toBe(200);
    expect(gone.json().places).toMatchObject([{ name: 'Second' }]);

    await app.prisma.page.update({ where: { id: owner.pageId }, data: { pickupEnabled: false } });
    const [last] = gone.json().places;
    expect((await call('DELETE', `/store/pickup-places/${last.id}`, owner.cookie)).json()).toEqual({ places: [] });
  });

  it('keeps an order\'s snapshot when its place is deleted', async () => {
    const owner = await anOwner();
    const [place] = await make(owner);
    const order = await app.prisma.order.create({
      data: {
        pageId: owner.pageId,
        number: 1,
        code: 'PK02',
        tokenHash: hashSessionValue(randomBytes(8).toString('hex')),
        customerName: 'Aisyah',
        phone: '+60123456789',
        method: 'PICKUP',
        day: new Date('2026-12-01T00:00:00Z'),
        itemsCents: 5_000,
        deliveryCents: 0,
        totalCents: 5_000,
        pickupPlaceId: place!.id,
        pickupPlaceName: 'Home',
      },
    });
    expect((await call('DELETE', `/store/pickup-places/${place!.id}`, owner.cookie)).statusCode).toBe(200);
    expect(await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ pickupPlaceId: null, pickupPlaceName: 'Home' });
  });

  it('answers 404 for another shop\'s place, on PUT and DELETE', async () => {
    const mine = await anOwner();
    const theirs = await anOwner();
    const [place] = await make(theirs);
    const put = await call('PUT', `/store/pickup-places/${place!.id}`, mine.cookie, home);
    expect(put.statusCode).toBe(404);
    expect(put.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'No such pickup place.' } });
    expect((await call('DELETE', `/store/pickup-places/${place!.id}`, mine.cookie)).statusCode).toBe(404);
    expect((await call('GET', '/store/pickup-places', theirs.cookie)).json().places).toHaveLength(1);
  });

  it('takes only an https: map link', async () => {
    const owner = await anOwner();
    for (const mapUrl of ['http://maps.example.com/x', 'javascript:alert(1)', 'maps.example.com', 'ftp://x.example.com']) {
      const res = await call('POST', '/store/pickup-places', owner.cookie, { ...home, mapUrl });
      expect(res.statusCode, mapUrl).toBe(400);
      expect(res.json(), mapUrl).toEqual(INVALID('A map link starts with https://.'));
    }
    expect((await call('GET', '/store/pickup-places', owner.cookie)).json().places).toEqual([]);
  });

  it('checks the name, address and note', async () => {
    const owner = await anOwner();
    const bad = async (patch: object) => (await call('POST', '/store/pickup-places', owner.cookie, { ...home, ...patch })).json();
    expect(await bad({ name: '  ' })).toEqual(INVALID('A place name is 1 to 60 characters.'));
    expect(await bad({ name: 'x'.repeat(61) })).toEqual(INVALID('A place name is 1 to 60 characters.'));
    expect(await bad({ address: '' })).toEqual(INVALID('An address is 1 to 160 characters.'));
    expect(await bad({ note: 'x'.repeat(121) })).toEqual(INVALID('A note is up to 120 characters.'));
  });

  it('reorders, and refuses a list that is not exactly the shop\'s places', async () => {
    const owner = await anOwner();
    await make(owner, { ...home, name: 'A' });
    const [a, b] = await make(owner, { ...home, name: 'B' });
    const res = await call('POST', '/store/pickup-places/order', owner.cookie, { ids: [b!.id, a!.id] });
    expect(res.statusCode).toBe(200);
    expect(res.json().places.map((p: { name: string }) => p.name)).toEqual(['B', 'A']);
    expect((await call('POST', '/store/pickup-places/order', owner.cookie, { ids: [a!.id] })).statusCode).toBe(400);
  });
});
