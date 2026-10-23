import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ADMIN_COOKIE, extendPaidUntil, MAIL_QUEUE, type MailJobData } from '@curios/core';
import { buildApp } from '../../app.js';
import type { AvatarStore } from '../pages/storage.js';
import { hashPassword } from '../auth/password.service.js';
import { createAdminSession } from './admin-session.service.js';

const mailQueue = { add: vi.fn(async (_name: string, _data: MailJobData, _opts?: unknown) => ({})) };
const store: AvatarStore & { put: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> } = {
  put: vi.fn(async () => undefined),
  remove: vi.fn(async () => undefined),
};

let app: FastifyInstance;
let previousOrigin: string | undefined;
let adminId: string;
let cookie: string;
const madeAccounts: string[] = [];

beforeAll(async () => {
  previousOrigin = process.env.ADMIN_ORIGIN;
  process.env.ADMIN_ORIGIN = 'http://localhost:3002';
  app = await buildApp({ admin: { mailQueue, store } });
  await app.ready();

  const admin = await app.prisma.adminUser.create({
    data: { email: `admin-${randomUUID()}@example.com`, name: 'Test Admin', passwordHash: await hashPassword('a-long-enough-passphrase') },
  });
  adminId = admin.id;
  cookie = await createAdminSession(app.prisma, admin.id, '127.0.0.1');
});

afterAll(async () => {
  // AdminAction restricts deletion of its admin, so the audit rows go first (tests only).
  await app.prisma.adminAction.deleteMany({ where: { adminUserId: adminId } });
  await app.prisma.adminUser.deleteMany({ where: { id: adminId } });
  await app.prisma.payment.deleteMany({ where: { ownerEmail: { endsWith: '@admin-pages.test' } } });
  await app.prisma.account.deleteMany({ where: { id: { in: madeAccounts } } });
  if (previousOrigin === undefined) delete process.env.ADMIN_ORIGIN;
  else process.env.ADMIN_ORIGIN = previousOrigin;
  await app.close();
});

beforeEach(() => {
  mailQueue.add.mockClear();
  store.remove.mockClear();
});

async function aPage(extra: Record<string, unknown> = {}) {
  const slug = `ap-${randomUUID().slice(0, 8)}`;
  const email = `${slug}@admin-pages.test`;
  const account = await app.prisma.account.create({
    data: {
      email,
      pages: { create: { handle: slug, skeleton: slug, displayName: 'Kek Lina', published: true, ...extra } },
    },
    select: { id: true, pages: { select: { id: true } } },
  });
  madeAccounts.push(account.id);
  return { handle: slug, email, accountId: account.id, id: account.pages[0]!.id };
}

const call = (method: 'POST' | 'DELETE', url: string, payload?: object, withCookie: string | null = cookie) =>
  app.inject({
    method,
    url,
    payload,
    cookies: withCookie ? { [ADMIN_COOKIE]: withCookie } : undefined,
  });

const actions = (targetId: string) => app.prisma.adminAction.findMany({ where: { targetId } });

describe('suspend and unsuspend', () => {
  it('suspends once, audits it, and mails the owner', async () => {
    const page = await aPage();
    const res = await call('POST', `/admin/pages/${page.id}/suspend`, { reason: '  Selling fakes  ' });

    expect(res.statusCode).toBe(204);
    const row = await app.prisma.page.findUniqueOrThrow({ where: { id: page.id } });
    expect(row.suspendedAt).not.toBeNull();
    expect(row.suspendReason).toBe('Selling fakes');

    const audit = await actions(page.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'SUSPENDED_PAGE',
      adminUserId: adminId,
      targetType: 'Page',
      targetLabel: page.handle,
      reason: 'Selling fakes',
    });

    expect(mailQueue.add).toHaveBeenCalledTimes(1);
    const [name, data] = mailQueue.add.mock.calls[0]!;
    expect(name).toBe(MAIL_QUEUE);
    expect(data.to).toBe(page.email);
    expect(data.subject).toBe('Your page has been suspended');
    expect(data.text).toContain('Selling fakes');

    const again = await call('POST', `/admin/pages/${page.id}/suspend`, { reason: 'Again' });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('PAGE_STATE');
    expect(await actions(page.id)).toHaveLength(1);
    expect(mailQueue.add).toHaveBeenCalledTimes(1);
  });

  it('unsuspends a suspended page and mails the owner; refuses one that is live', async () => {
    const live = await aPage();
    const refused = await call('POST', `/admin/pages/${live.id}/unsuspend`, { reason: 'Mistake' });
    expect(refused.statusCode).toBe(409);
    expect(await actions(live.id)).toHaveLength(0);

    const page = await aPage({ suspendedAt: new Date(), suspendReason: 'x', language: 'ms' });
    const res = await call('POST', `/admin/pages/${page.id}/unsuspend`, { reason: 'Checked' });
    expect(res.statusCode).toBe(204);
    const row = await app.prisma.page.findUniqueOrThrow({ where: { id: page.id } });
    expect(row.suspendedAt).toBeNull();
    expect(row.suspendReason).toBeNull();
    expect((await actions(page.id))[0]).toMatchObject({ action: 'UNSUSPENDED_PAGE' });
    expect(mailQueue.add.mock.calls[0]![1].subject).toBe('Halaman anda kembali');
  });

  it('keeps the change when the mail cannot be queued', async () => {
    const page = await aPage();
    mailQueue.add.mockRejectedValueOnce(new Error('redis down'));
    const res = await call('POST', `/admin/pages/${page.id}/suspend`, { reason: 'Fakes' });
    expect(res.statusCode).toBe(204);
    expect((await app.prisma.page.findUniqueOrThrow({ where: { id: page.id } })).suspendedAt).not.toBeNull();
  });

  it('404s an unknown page', async () => {
    const res = await call('POST', '/admin/pages/nope/suspend', { reason: 'x' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('PAGE_NOT_FOUND');
  });
});

describe('grant-month', () => {
  it('adds a month after a paidUntil that is still ahead, with a GRANT payment', async () => {
    const ahead = new Date(Date.now() + 10 * 86_400_000);
    const page = await aPage({ paidUntil: ahead });
    const res = await call('POST', `/admin/pages/${page.id}/grant-month`, { reason: 'Goodwill' });

    expect(res.statusCode).toBe(204);
    const row = await app.prisma.page.findUniqueOrThrow({ where: { id: page.id } });
    const expected = extendPaidUntil({ paidUntil: ahead, plan: 'MONTHLY', now: new Date() });
    expect(row.paidUntil).toEqual(expected);

    const payments = await app.prisma.payment.findMany({ where: { pageId: page.id } });
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({
      provider: 'GRANT',
      plan: 'MONTHLY',
      amountCents: 0,
      status: 'PAID',
      pageHandle: page.handle,
      ownerEmail: page.email,
    });
    expect(payments[0]!.grantedUntil).toEqual(expected);

    const audit = await actions(page.id);
    expect(audit[0]).toMatchObject({ action: 'GRANTED_MONTH', metadata: { paidUntil: expected.toISOString() } });
  });

  it('four grants at once add four months and leave payments, audit rows and paidUntil agreeing', async () => {
    const start = new Date(Date.now() + 10 * 86_400_000);
    const page = await aPage({ paidUntil: start });
    const results = await Promise.all(
      Array.from({ length: 4 }, () => call('POST', `/admin/pages/${page.id}/grant-month`, { reason: 'Double click' })),
    );
    expect(results.map((r) => r.statusCode)).toEqual([204, 204, 204, 204]);

    let twice = start;
    for (let i = 0; i < 4; i++) twice = extendPaidUntil({ paidUntil: twice, plan: 'MONTHLY', now: new Date() });
    const row = await app.prisma.page.findUniqueOrThrow({ where: { id: page.id } });
    expect(row.paidUntil).toEqual(twice);
    const payments = await app.prisma.payment.findMany({ where: { pageId: page.id }, orderBy: { grantedUntil: 'asc' } });
    expect(payments).toHaveLength(4);
    expect(payments[3]!.grantedUntil).toEqual(row.paidUntil);
    expect(new Set(payments.map((p) => p.grantedUntil!.getTime())).size).toBe(4);
    expect(await actions(page.id)).toHaveLength(4);
  });

  it('counts a lapsed page from now', async () => {
    const page = await aPage({ paidUntil: new Date(Date.now() - 20 * 86_400_000) });
    const before = Date.now();
    await call('POST', `/admin/pages/${page.id}/grant-month`, { reason: 'Goodwill' });
    const row = await app.prisma.page.findUniqueOrThrow({ where: { id: page.id } });
    const floor = extendPaidUntil({ paidUntil: null, plan: 'MONTHLY', now: new Date(before) });
    const ceil = extendPaidUntil({ paidUntil: null, plan: 'MONTHLY', now: new Date() });
    expect(row.paidUntil!.getTime()).toBeGreaterThanOrEqual(floor.getTime());
    expect(row.paidUntil!.getTime()).toBeLessThanOrEqual(ceil.getTime());
  });
});

describe('reset-conversations', () => {
  it('zeroes the month and clears capMailedAt', async () => {
    const page = await aPage();
    const period = new Date().toISOString().slice(0, 7);
    await app.prisma.usageCounter.create({ data: { pageId: page.id, period, count: 50, capMailedAt: new Date() } });

    const res = await call('POST', `/admin/pages/${page.id}/reset-conversations`, { reason: 'Support' });
    expect(res.statusCode).toBe(204);
    const counter = await app.prisma.usageCounter.findUniqueOrThrow({ where: { pageId_period: { pageId: page.id, period } } });
    expect(counter).toMatchObject({ count: 0, capMailedAt: null });
    expect((await actions(page.id))[0]).toMatchObject({ action: 'RESET_CONVERSATIONS' });
  });

  it('is a 204 even with no counter, and writes the row', async () => {
    const page = await aPage();
    const res = await call('POST', `/admin/pages/${page.id}/reset-conversations`, { reason: 'Support' });
    expect(res.statusCode).toBe(204);
    expect(await app.prisma.usageCounter.count({ where: { pageId: page.id, count: 0 } })).toBe(1);
  });
});

describe('view-as-owner', () => {
  it('writes VIEWED_AS_OWNER', async () => {
    const page = await aPage();
    const res = await call('POST', `/admin/pages/${page.id}/view-as-owner`, { reason: 'Support ticket 12' });
    expect(res.statusCode).toBe(204);
    expect((await actions(page.id))[0]).toMatchObject({ action: 'VIEWED_AS_OWNER', reason: 'Support ticket 12' });
  });
});

describe('DELETE /admin/pages/:id', () => {
  it('refuses a wrong handle and deletes nothing', async () => {
    const page = await aPage();
    const res = await call('DELETE', `/admin/pages/${page.id}`, { reason: 'Asked to', handle: 'someone-else' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('HANDLE_MISMATCH');
    expect(await app.prisma.account.count({ where: { id: page.accountId } })).toBe(1);
    expect(await actions(page.id)).toHaveLength(0);
  });

  it('deletes the account with everything that hangs off it, keeps the payment, and removes the files', async () => {
    const page = await aPage({ avatarKey: 'avatars/a.png', coverKey: 'covers/c.jpg', paymentQrKey: 'qr/q.png' });
    await app.prisma.item.create({ data: { pageId: page.id, name: 'Tart', slug: 'tart', position: 0, photoKey: 'items/t.jpg' } });
    await app.prisma.payment.create({
      data: { pageId: page.id, plan: 'MONTHLY', amountCents: 4900, status: 'PAID', paidAt: new Date(), providerRef: `ref-${randomUUID()}` },
    });
    await app.prisma.renewalCard.create({ data: { pageId: page.id, token: `tok-${randomUUID()}`, plan: 'MONTHLY' } });
    await app.prisma.shopPaymentAccount.create({
      data: { pageId: page.id, brandId: 'brand', secretKeyCiphertext: 'sealed', publicKeyPem: 'pem', checkedAt: new Date() },
    });
    const order = await app.prisma.order.create({
      data: {
        pageId: page.id,
        number: 1,
        code: 'ABCD',
        tokenHash: `hash-${randomUUID()}`,
        customerName: 'Aisyah',
        phone: '0123456789',
        method: 'PICKUP',
        day: new Date('2026-11-01'),
        itemsCents: 2000,
        deliveryCents: 0,
        totalCents: 2000,
        receiptKey: 'receipts/r.jpg',
        lines: { create: [{ itemName: 'Tart', unitPriceCents: 2000, quantity: 1, position: 0 }] },
      },
    });
    await app.prisma.conversation.create({ data: { pageId: page.id, pendingOrderId: order.id } });

    const res = await call('DELETE', `/admin/pages/${page.id}`, { reason: 'Owner asked', handle: page.handle.toUpperCase() });
    expect(res.statusCode).toBe(204);

    expect(await app.prisma.account.count({ where: { id: page.accountId } })).toBe(0);
    expect(await app.prisma.page.count({ where: { id: page.id } })).toBe(0);
    expect(await app.prisma.order.count({ where: { id: order.id } })).toBe(0);

    const payments = await app.prisma.payment.findMany({ where: { ownerEmail: page.email } });
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ pageId: null, pageHandle: page.handle, ownerEmail: page.email });

    const audit = await actions(page.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'DELETED_ACCOUNT', targetLabel: page.handle, reason: 'Owner asked' });

    expect(store.remove.mock.calls.map((c) => c[0]).sort()).toEqual(
      ['avatars/a.png', 'covers/c.jpg', 'items/t.jpg', 'qr/q.png', 'receipts/r.jpg'],
    );
  });

  it('two deletes at once: one 204, one 404, one audit row', async () => {
    const page = await aPage();
    const send = () => call('DELETE', `/admin/pages/${page.id}`, { reason: 'Owner asked', handle: page.handle });
    const results = await Promise.all([send(), send()]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([204, 404]);
    const gone = results.find((r) => r.statusCode === 404)!;
    expect(gone.json().error.code).toBe('PAGE_NOT_FOUND');
    const audit = await actions(page.id);
    expect(audit.filter((a) => a.action === 'DELETED_ACCOUNT')).toHaveLength(1);
  });

  it('does not try to remove a stock cover, and survives a failed removal', async () => {
    const page = await aPage({ coverKey: 'stock/kedai', avatarKey: 'avatars/b.png' });
    store.remove.mockRejectedValueOnce(new Error('r2 down'));
    const res = await call('DELETE', `/admin/pages/${page.id}`, { reason: 'Owner asked', handle: page.handle });
    expect(res.statusCode).toBe(204);
    expect(store.remove.mock.calls.map((c) => c[0])).toEqual(['avatars/b.png']);
  });
});

describe('every route', () => {
  const routes = [
    ['POST', 'suspend'],
    ['POST', 'unsuspend'],
    ['POST', 'grant-month'],
    ['POST', 'reset-conversations'],
    ['POST', 'view-as-owner'],
    ['DELETE', ''],
  ] as const;

  const url = (id: string, tail: string) => `/admin/pages/${id}${tail ? `/${tail}` : ''}`;
  const body = (method: string, reason?: string) =>
    method === 'DELETE' ? { reason, handle: 'x' } : { reason };

  it.each(routes)('%s %s needs a reason', async (method, tail) => {
    const page = await aPage();
    for (const reason of [undefined, '', '   ', 'x'.repeat(501)]) {
      const res = await call(method, url(page.id, tail), body(method, reason));
      expect(res.statusCode).toBe(400);
    }
    expect(await actions(page.id)).toHaveLength(0);
  });

  it.each(routes)('%s %s needs an admin session', async (method, tail) => {
    const page = await aPage();
    const res = await call(method, url(page.id, tail), body(method, 'Because'), null);
    expect(res.statusCode).toBe(401);
    // An owner's cookie is not an admin's.
    const owner = await call(method, url(page.id, tail), body(method, 'Because'), 'not-a-session');
    expect(owner.statusCode).toBe(401);
    expect(await actions(page.id)).toHaveLength(0);
  });
});
