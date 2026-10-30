import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { createSession, SESSION_COOKIE } from '../auth/session.service.js';

let app: FastifyInstance;
let nth = 0;
const from = () => `198.51.100.${(nth++ % 200) + 1}`;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

async function anOwner(options: { mode?: 'BUSINESS' | 'PERSONAL'; storeEnabled?: boolean; published?: boolean } = {}) {
  const slug = randomUUID().slice(0, 8);
  const handle = `vo-${slug}`;
  const account = await app.prisma.account.create({
    data: {
      email: `voucher-${randomUUID()}@example.com`,
      emailVerifiedAt: new Date(),
      pages: {
        create: {
          handle,
          skeleton: handle,
          displayName: 'Kek Lina',
          mode: options.mode ?? 'BUSINESS',
          published: options.published ?? true,
          storeEnabled: options.storeEnabled ?? true,
          items: { create: [{ name: 'Kek Batik', slug: 'kek-batik', priceCents: 9500, position: 0 }] },
        },
      },
    },
    select: { id: true, pages: { select: { id: true, items: { select: { id: true } } } } },
  });
  const page = account.pages[0];
  return { handle, cookie: (await createSession(app.prisma, account.id)).value, pageId: page?.id ?? '', itemId: page?.items[0]?.id ?? '' };
}

const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, cookie?: string, payload?: object) =>
  app.inject({ method, url, remoteAddress: from(), ...(cookie ? { cookies: { [SESSION_COOKIE]: cookie } } : {}), ...(payload ? { payload } : {}) });

const blank = { mode: 'CODE', code: null, name: null, kind: 'PERCENT', percent: 10, amountCents: null, itemId: null, minSpendCents: null, endsOn: null, maxUses: null };
const raya = { ...blank, code: 'RAYA10' };
const make = async (owner: { cookie: string }, body: object) => (await call('POST', '/store/vouchers', owner.cookie, body)).json().voucher as { id: string };
const check = (owner: { handle: string }, code: string) => call('POST', `/store/${owner.handle}/vouchers/check`, undefined, { code });

const REFUSED = { error: { code: 'VOUCHER_UNKNOWN', message: "That code doesn't work here." } };

describe('owner vouchers', () => {
  it('makes, lists, edits, switches off and deletes a voucher', async () => {
    const owner = await anOwner();
    const made = await call('POST', '/store/vouchers', owner.cookie, { ...raya, code: ' raya10 ', endsOn: '2026-12-31', maxUses: 5 });
    expect(made.statusCode).toBe(201);
    const voucher = made.json().voucher;
    expect(voucher).toMatchObject({
      mode: 'CODE', code: 'RAYA10', name: null, label: 'RAYA10', kind: 'PERCENT', percent: 10, maxUses: 5,
      active: true, uses: 0, state: 'on', itemName: null, endsAt: '2026-12-31T16:00:00.000Z',
    });

    expect((await call('GET', '/store/vouchers', owner.cookie)).json().vouchers).toMatchObject([{ id: voucher.id, code: 'RAYA10' }]);

    // The patch is merged with what is stored: endsOn survives a change to something else.
    const edited = await call('PATCH', `/store/vouchers/${voucher.id}`, owner.cookie, { percent: 15 });
    expect(edited.json().voucher).toMatchObject({ percent: 15, endsAt: '2026-12-31T16:00:00.000Z', maxUses: 5 });

    const off = await call('PATCH', `/store/vouchers/${voucher.id}`, owner.cookie, { active: false });
    expect(off.json().voucher).toMatchObject({ active: false, state: 'off', percent: 15 });

    const kind = await call('PATCH', `/store/vouchers/${voucher.id}`, owner.cookie, { kind: 'AMOUNT', percent: null, amountCents: 500, endsOn: null });
    expect(kind.json().voucher).toMatchObject({ kind: 'AMOUNT', percent: null, amountCents: 500, endsAt: null });

    expect((await call('DELETE', `/store/vouchers/${voucher.id}`, owner.cookie)).statusCode).toBe(204);
    expect((await call('GET', '/store/vouchers', owner.cookie)).json().vouchers).toEqual([]);
    expect((await call('DELETE', `/store/vouchers/${voucher.id}`, owner.cookie)).statusCode).toBe(404);
  });

  it('keeps an automatic voucher by its name, with no code', async () => {
    const owner = await anOwner();
    const voucher = await make(owner, { ...blank, mode: 'AUTO', name: ' Raya sale ', code: null });
    expect(voucher).toMatchObject({ mode: 'AUTO', code: null, name: 'Raya sale', label: 'Raya sale' });
  });

  it('refuses a code the shop already has, however it is typed, but not another shop', async () => {
    const owner = await anOwner();
    await make(owner, raya);
    const again = await call('POST', '/store/vouchers', owner.cookie, { ...raya, code: 'raya10' });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('VOUCHER_CODE_TAKEN');
    expect((await call('POST', '/store/vouchers', (await anOwner()).cookie, raya)).statusCode).toBe(201);

    const other = await make(owner, { ...raya, code: 'RAYA20' });
    const clash = await call('PATCH', `/store/vouchers/${other.id}`, owner.cookie, { code: 'raya10' });
    expect(clash.statusCode).toBe(409);
    expect(clash.json().error.code).toBe('VOUCHER_CODE_TAKEN');
  });

  it('refuses a percent of 0 or 101, and a patch whose merged whole is wrong', async () => {
    const owner = await anOwner();
    for (const percent of [0, 101]) {
      const res = await call('POST', '/store/vouchers', owner.cookie, { ...raya, percent });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toEqual({ code: 'VOUCHER_INVALID', message: 'A percent voucher takes 1 to 100 percent off.' });
    }
    const voucher = await make(owner, raya);
    const res = await call('PATCH', `/store/vouchers/${voucher.id}`, owner.cookie, { percent: 101 });
    expect(res.json().error.code).toBe('VOUCHER_INVALID');
    // Switching to an amount without taking the percent away leaves a voucher that is both.
    expect((await call('PATCH', `/store/vouchers/${voucher.id}`, owner.cookie, { kind: 'AMOUNT', amountCents: 500 })).json().error.code).toBe('VOUCHER_INVALID');
  });

  it("refuses an item from another shop, and covers one of the shop's own", async () => {
    const owner = await anOwner();
    const other = await anOwner();
    const res = await call('POST', '/store/vouchers', owner.cookie, { ...raya, itemId: other.itemId });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VOUCHER_INVALID');
    const voucher = await make(owner, raya);
    expect((await call('PATCH', `/store/vouchers/${voucher.id}`, owner.cookie, { itemId: other.itemId })).statusCode).toBe(400);

    const own = await call('POST', '/store/vouchers', owner.cookie, { ...raya, code: 'KEK10', itemId: owner.itemId });
    expect(own.json().voucher).toMatchObject({ itemId: owner.itemId, itemName: 'Kek Batik' });
  });

  it('refuses a personal page and a signed-out caller, and cannot reach another shop\'s voucher', async () => {
    const personal = await anOwner({ mode: 'PERSONAL' });
    expect((await call('POST', '/store/vouchers', personal.cookie, raya)).json().error.code).toBe('STORE_BUSINESS_ONLY');
    expect((await call('GET', '/store/vouchers', personal.cookie)).json().error.code).toBe('STORE_BUSINESS_ONLY');
    expect((await call('GET', '/store/vouchers')).statusCode).toBe(401);

    const a = await anOwner();
    const b = await anOwner();
    const voucher = await make(a, raya);
    expect((await call('PATCH', `/store/vouchers/${voucher.id}`, b.cookie, { percent: 50 })).statusCode).toBe(404);
    expect((await call('DELETE', `/store/vouchers/${voucher.id}`, b.cookie)).statusCode).toBe(404);
    expect(await app.prisma.shopVoucher.count({ where: { id: voucher.id } })).toBe(1);
  });

  it('counts uses, but not an order cancelled before it was paid', async () => {
    const owner = await anOwner();
    const voucher = await make(owner, { ...raya, maxUses: 2 });
    await anOrder(owner.pageId, 1, { voucherId: voucher.id });
    await anOrder(owner.pageId, 2, { voucherId: voucher.id, status: 'CANCELLED', cancelledAt: new Date() });
    expect((await call('GET', '/store/vouchers', owner.cookie)).json().vouchers[0]).toMatchObject({ uses: 1, state: 'on' });
    await anOrder(owner.pageId, 3, { voucherId: voucher.id, status: 'CANCELLED', cancelledAt: new Date(), paidAt: new Date() });
    expect((await call('GET', '/store/vouchers', owner.cookie)).json().vouchers[0]).toMatchObject({ uses: 2, state: 'usedUp' });
  });

  it('deleting a voucher leaves its orders their snapshot', async () => {
    const owner = await anOwner();
    const voucher = await make(owner, raya);
    const orderId = await anOrder(owner.pageId, 1, { voucherId: voucher.id, voucherLabel: 'RAYA10', discountCents: 950 });
    expect((await call('DELETE', `/store/vouchers/${voucher.id}`, owner.cookie)).statusCode).toBe(204);
    expect(await app.prisma.order.findUnique({ where: { id: orderId }, select: { voucherId: true, voucherLabel: true, discountCents: true } })).toEqual({
      voucherId: null,
      voucherLabel: 'RAYA10',
      discountCents: 950,
    });
  });

  // Review Focus 4.
  it("deleting an item deletes its one-item voucher, and no other", async () => {
    const owner = await anOwner();
    const one = await make(owner, { ...raya, code: 'KEK10', itemId: owner.itemId });
    const whole = await make(owner, raya);
    expect((await call('DELETE', `/store/items/${owner.itemId}`, owner.cookie)).statusCode).toBe(200);
    const left = (await call('GET', '/store/vouchers', owner.cookie)).json().vouchers as { id: string }[];
    expect(left.map((v) => v.id)).toEqual([whole.id]);
    expect(left.map((v) => v.id)).not.toContain(one.id);
  });
});

async function anOrder(pageId: string, number: number, data: Record<string, unknown> = {}): Promise<string> {
  const order = await app.prisma.order.create({
    data: {
      pageId,
      number,
      code: `A${number}BC`,
      tokenHash: randomUUID(),
      customerName: 'Aisyah',
      phone: '+60123456789',
      itemsCents: 9500,
      deliveryCents: 0,
      totalCents: 9500,
      ...data,
    },
    select: { id: true },
  });
  return order.id;
}

describe('POST /store/:handle/vouchers/check', () => {
  it('finds a code however it is typed, and returns its terms with the code as the label', async () => {
    const owner = await anOwner();
    const voucher = await make(owner, { ...raya, minSpendCents: 5000 });
    const res = await check(owner, ' raya10 ');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      voucher: { id: voucher.id, mode: 'CODE', kind: 'PERCENT', percent: 10, amountCents: null, itemId: null, minSpendCents: 5000, label: 'RAYA10' },
    });
    expect((await call('POST', `/store/${owner.handle.toUpperCase()}/vouchers/check`, undefined, { code: 'RAYA10' })).statusCode).toBe(200);
  });

  // Review Focus 5.
  it('answers an unknown, off, ended and used-up code with the same 404', async () => {
    const owner = await anOwner();
    const off = await make(owner, { ...raya, code: 'OFF10' });
    await call('PATCH', `/store/vouchers/${off.id}`, owner.cookie, { active: false });
    await app.prisma.shopVoucher.create({ data: { pageId: owner.pageId, mode: 'CODE', code: 'ENDED10', kind: 'PERCENT', percent: 10, endsAt: new Date(Date.now() - 60_000) } });
    const full = await make(owner, { ...raya, code: 'FULL10', maxUses: 1 });
    await anOrder(owner.pageId, 1, { voucherId: full.id });

    for (const code of ['NOPE10', 'OFF10', 'ENDED10', 'FULL10', '']) {
      const res = await check(owner, code);
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual(REFUSED);
    }
  });

  it('gives a used-up code back when the order that used it was cancelled unpaid', async () => {
    const owner = await anOwner();
    const full = await make(owner, { ...raya, maxUses: 1 });
    const orderId = await anOrder(owner.pageId, 1, { voucherId: full.id });
    expect((await check(owner, 'RAYA10')).statusCode).toBe(404);
    await app.prisma.order.update({ where: { id: orderId }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
    expect((await check(owner, 'RAYA10')).statusCode).toBe(200);
  });

  it('never returns an automatic voucher, nor another shop\'s code', async () => {
    const owner = await anOwner();
    const other = await anOwner();
    await make(owner, { ...blank, mode: 'AUTO', name: 'RAYA' });
    await make(other, raya);
    expect((await check(owner, 'RAYA')).json()).toEqual(REFUSED);
    expect((await check(owner, 'RAYA10')).json()).toEqual(REFUSED);
  });

  it('answers only for a published business shop that is open', async () => {
    for (const options of [{ storeEnabled: false }, { published: false }, { mode: 'PERSONAL' as const }]) {
      const owner = await anOwner();
      await app.prisma.shopVoucher.create({ data: { pageId: owner.pageId, mode: 'CODE', code: 'RAYA10', kind: 'PERCENT', percent: 10 } });
      await app.prisma.page.update({ where: { id: owner.pageId }, data: options });
      expect((await check(owner, 'RAYA10')).json()).toEqual(REFUSED);
    }
    expect((await call('POST', '/store/no-such-shop/vouchers/check', undefined, { code: 'RAYA10' })).json()).toEqual(REFUSED);
  });
});
