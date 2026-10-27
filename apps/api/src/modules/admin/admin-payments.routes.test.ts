import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ADMIN_COOKIE } from '@curios/core';
import { ChipUnavailableError, type ChipClient, type ChipPurchase } from '@curios/billing';
import { buildApp } from '../../app.js';
import { hashPassword } from '../auth/password.service.js';
import { createAdminSession } from './admin-session.service.js';

// CHIP, stubbed as the billing routes' own tests stub it: the replay asks it about the purchase.
const client = {
  createPurchase: vi.fn<ChipClient['createPurchase']>(),
  getPurchase: vi.fn<ChipClient['getPurchase']>(),
  chargePurchase: vi.fn<ChipClient['chargePurchase']>(),
  deleteRecurringToken: vi.fn<ChipClient['deleteRecurringToken']>(),
  cancelPurchase: vi.fn<ChipClient['cancelPurchase']>(),
  getPublicKey: vi.fn<ChipClient['getPublicKey']>(),
  listPaymentMethods: vi.fn<ChipClient['listPaymentMethods']>(),
};

let app: FastifyInstance;
let previousOrigin: string | undefined;
let adminId: string;
let cookie: string;
const madeAccounts: string[] = [];

beforeAll(async () => {
  previousOrigin = process.env.ADMIN_ORIGIN;
  process.env.ADMIN_ORIGIN = 'http://localhost:3002';
  app = await buildApp({ billing: { client }, admin: { store: null, privateFiles: null } });
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
  await app.prisma.account.deleteMany({ where: { id: { in: madeAccounts } } });
  // ChipWebhookEvent is reached by no truncate cascade.
  await app.prisma.chipWebhookEvent.deleteMany();
  if (previousOrigin === undefined) delete process.env.ADMIN_ORIGIN;
  else process.env.ADMIN_ORIGIN = previousOrigin;
  await app.close();
});

beforeEach(() => {
  for (const fn of Object.values(client)) fn.mockReset();
});

/** A pending CHIP payment, and the purchase.paid webhook that failed for it. */
async function aFailedPaidWebhook() {
  const slug = `ap-${randomUUID().slice(0, 8)}`;
  const account = await app.prisma.account.create({
    data: { email: `${slug}@admin-payments.test`, pages: { create: { handle: slug, skeleton: slug, displayName: 'Kek Lina' } } },
    select: { id: true, pages: { select: { id: true } } },
  });
  madeAccounts.push(account.id);
  const pageId = account.pages[0]!.id;
  const providerRef = `purchase-${randomUUID()}`;
  const payment = await app.prisma.payment.create({
    data: { pageId, plan: 'MONTHLY', amountCents: 4900, provider: 'CHIP', providerRef },
    select: { id: true },
  });
  const event = await app.prisma.chipWebhookEvent.create({
    data: {
      source: 'webhook',
      eventType: 'purchase.paid',
      purchaseId: providerRef,
      body: JSON.stringify({ id: providerRef, event_type: 'purchase.paid' }),
      outcome: 'failed',
      statusCode: 502,
      error: 'ChipUnavailableError',
      lastAttemptAt: new Date(Date.now() - 60_000),
    },
  });
  return { handle: slug, pageId, providerRef, paymentId: payment.id, eventId: event.id };
}

const paidPurchase = (providerRef: string, paymentId: string): ChipPurchase => ({
  id: providerRef,
  status: 'paid',
  reference: paymentId,
  totalCents: 4900,
  checkoutUrl: 'https://gate.chip-in.asia/p/x/',
  isRecurringToken: false,
  isTest: true,
  paymentMethod: 'fpx',
  maskedPan: null,
});

const replay = (id: string, payload: object | undefined = { reason: 'CHIP was down at 09:00' }, withCookie: string | null = cookie) =>
  app.inject({
    method: 'POST',
    url: `/admin/webhooks/${id}/replay`,
    payload,
    cookies: withCookie ? { [ADMIN_COOKIE]: withCookie } : undefined,
  });

const eventRow = (id: string) => app.prisma.chipWebhookEvent.findUniqueOrThrow({ where: { id } });
const paidUntilOf = async (pageId: string) =>
  (await app.prisma.page.findUniqueOrThrow({ where: { id: pageId }, select: { paidUntil: true } })).paidUntil;

describe('POST /admin/webhooks/:id/replay', () => {
  it('replaying a failed purchase.paid grants once, and replaying it again leaves paidUntil where it was', async () => {
    const hook = await aFailedPaidWebhook();
    client.getPurchase.mockResolvedValue(paidPurchase(hook.providerRef, hook.paymentId));

    const first = await replay(hook.eventId);

    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ status: 'granted' });
    const granted = await paidUntilOf(hook.pageId);
    expect(granted).not.toBeNull();
    expect(await eventRow(hook.eventId)).toMatchObject({ attempts: 2, outcome: 'ok', statusCode: 200, error: null });

    const second = await replay(hook.eventId);

    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ status: 'already-granted' });
    expect(await paidUntilOf(hook.pageId)).toEqual(granted);
    expect((await eventRow(hook.eventId)).attempts).toBe(3);
  });

  it('writes an audit row per replay, about the payment, labelled with its page', async () => {
    const hook = await aFailedPaidWebhook();
    client.getPurchase.mockResolvedValue(paidPurchase(hook.providerRef, hook.paymentId));

    await replay(hook.eventId, { reason: '  CHIP was down  ' });

    const rows = await app.prisma.adminAction.findMany({ where: { targetId: hook.paymentId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      adminUserId: adminId,
      action: 'REPLAYED_WEBHOOK',
      targetType: 'Payment',
      targetLabel: hook.handle,
      reason: 'CHIP was down',
    });
  });

  it('labels the audit row with the purchase id when no payment has it', async () => {
    const providerRef = `purchase-${randomUUID()}`;
    const event = await app.prisma.chipWebhookEvent.create({
      data: {
        source: 'webhook',
        eventType: 'purchase.payment_failure',
        purchaseId: providerRef,
        body: JSON.stringify({ id: providerRef, event_type: 'purchase.payment_failure' }),
        lastAttemptAt: new Date(),
      },
    });

    const res = await replay(event.id);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ignored' });
    const rows = await app.prisma.adminAction.findMany({ where: { targetId: providerRef } });
    expect(rows).toMatchObject([{ action: 'REPLAYED_WEBHOOK', targetType: 'Payment', targetLabel: providerRef }]);
  });

  it('records a replay that fails again, and answers the failure', async () => {
    const hook = await aFailedPaidWebhook();
    client.getPurchase.mockRejectedValue(new ChipUnavailableError('timeout'));

    const res = await replay(hook.eventId);

    expect(res.statusCode).toBe(502);
    expect(await eventRow(hook.eventId)).toMatchObject({ attempts: 2, outcome: 'failed', statusCode: 502, error: 'ChipUnavailableError' });
    expect(await paidUntilOf(hook.pageId)).toBeNull();
    expect(await app.prisma.adminAction.count({ where: { targetId: hook.paymentId } })).toBe(1);
  });

  it('is a 401 without an admin, and replays nothing', async () => {
    const hook = await aFailedPaidWebhook();

    expect((await replay(hook.eventId, { reason: 'x' }, null)).statusCode).toBe(401);
    expect(client.getPurchase).not.toHaveBeenCalled();
    expect((await eventRow(hook.eventId)).attempts).toBe(1);
  });

  it('is a 400 without a reason', async () => {
    const hook = await aFailedPaidWebhook();

    expect((await replay(hook.eventId, {})).statusCode).toBe(400);
    expect((await replay(hook.eventId, { reason: '   ' })).statusCode).toBe(400);
    expect(client.getPurchase).not.toHaveBeenCalled();
  });

  it('is a 404 WEBHOOK_NOT_FOUND for a message that is not there', async () => {
    const res = await replay('no-such-event');

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'WEBHOOK_NOT_FOUND' } });
  });
});
