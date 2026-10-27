import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { ChipUnavailableError, type ChipClient, type ChipPurchase } from '@curios/billing';
import { handleChipMessage, recordAndHandle, type ChipMessageDeps } from './chip-message.js';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

const getPurchase = vi.fn<ChipClient['getPurchase']>();
const onRenewalFailure = vi.fn<ChipMessageDeps['onRenewalFailure']>();
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as FastifyBaseLogger;
const deps = {
  prisma,
  client: { getPurchase } as unknown as ChipClient,
  onRenewalFailure,
  log,
} as unknown as ChipMessageDeps;

beforeEach(async () => {
  getPurchase.mockReset();
  onRenewalFailure.mockReset().mockResolvedValue(undefined);
  await prisma.$executeRawUnsafe('TRUNCATE "Account", "ChipWebhookEvent" CASCADE');
});

afterAll(async () => {
  // ChipWebhookEvent is reached by no cascade from Account: the last test's rows go here.
  await prisma.chipWebhookEvent.deleteMany();
  await prisma.$disconnect();
});

async function aPendingPayment() {
  const slug = `cm-${randomUUID().slice(0, 8)}`;
  const account = await prisma.account.create({
    data: { email: `${slug}@example.com`, pages: { create: { handle: slug, skeleton: slug, displayName: 'Kek Lina' } } },
    select: { pages: { select: { id: true } } },
  });
  const pageId = account.pages[0]!.id;
  const providerRef = `purchase-${randomUUID()}`;
  const payment = await prisma.payment.create({
    data: { pageId, plan: 'MONTHLY', amountCents: 4900, provider: 'CHIP', providerRef },
    select: { id: true },
  });
  return { pageId, providerRef, paymentId: payment.id };
}

const purchase = (providerRef: string, paymentId: string): ChipPurchase => ({
  id: providerRef,
  status: 'paid',
  reference: paymentId,
  totalCents: 4900,
  checkoutUrl: 'https://gate.chip-in.asia/p/x/',
  isRecurringToken: false,
  isTest: true,
  paymentMethod: 'razer_tng',
  maskedPan: null,
});

describe('handleChipMessage', () => {
  it('grants a paid purchase named by a webhook, from what CHIP says about it', async () => {
    const { providerRef, paymentId } = await aPendingPayment();
    getPurchase.mockResolvedValue(purchase(providerRef, paymentId));

    const result = await handleChipMessage(deps, { source: 'webhook', body: { id: providerRef, event_type: 'purchase.paid' } });

    expect(result).toEqual({ status: 'granted' });
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, select: { paidVia: true } })).toEqual({
      paidVia: 'TNG eWallet',
    });
  });

  it('ignores a body with no purchase id, and an event it does not act on', async () => {
    expect(await handleChipMessage(deps, { source: 'callback', body: { nothing: 'here' } })).toEqual({ status: 'ignored' });
    expect(await handleChipMessage(deps, { source: 'webhook', body: { id: 'p', event_type: 'purchase.created' } })).toEqual({
      status: 'ignored',
    });
    expect(getPurchase).not.toHaveBeenCalled();
  });
});

describe('recordAndHandle', () => {
  const row = (purchaseId: string) => prisma.chipWebhookEvent.findMany({ where: { purchaseId } });

  it('keeps the body as it was signed, and names a message with no event type "unknown"', async () => {
    const { providerRef, paymentId } = await aPendingPayment();
    getPurchase.mockResolvedValue(purchase(providerRef, paymentId));
    const rawBody = `{ "id" : "${providerRef}" }`;

    await recordAndHandle(deps, { source: 'callback', body: JSON.parse(rawBody), rawBody });

    expect(await row(providerRef)).toMatchObject([
      { source: 'callback', eventType: 'unknown', body: rawBody, attempts: 1, outcome: 'ok', statusCode: 200 },
    ]);
  });

  it("stores a failure's status and name, rethrows it, and keeps CHIP's words out of the row", async () => {
    const { providerRef } = await aPendingPayment();
    getPurchase.mockRejectedValue(new ChipUnavailableError('connect ECONNREFUSED payer@example.com'));
    const body = { id: providerRef, event_type: 'purchase.paid' };

    await expect(recordAndHandle(deps, { source: 'webhook', body, rawBody: JSON.stringify(body) })).rejects.toBeInstanceOf(
      ChipUnavailableError,
    );

    const [event] = await row(providerRef);
    expect(event).toMatchObject({ outcome: 'failed', statusCode: 502, error: 'ChipUnavailableError' });
  });

  it('still answers when the outcome cannot be written after the message was handled', async () => {
    const { providerRef, paymentId } = await aPendingPayment();
    getPurchase.mockResolvedValue(purchase(providerRef, paymentId));
    const body = { id: providerRef, event_type: 'purchase.paid' };
    const failing: ChipMessageDeps = {
      ...deps,
      prisma: new Proxy(prisma, {
        get(target, prop) {
          if (prop !== 'chipWebhookEvent') {
            const value = Reflect.get(target, prop) as unknown;
            return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
          }
          const delegate = target.chipWebhookEvent;
          return { upsert: delegate.upsert.bind(delegate), update: () => Promise.reject(new Error('database went away')) };
        },
      }),
    };

    expect(await recordAndHandle(failing, { source: 'webhook', body, rawBody: JSON.stringify(body) })).toEqual({ status: 'granted' });
  });

  /** deps whose ChipWebhookEvent delegate answers `upsert` with `upsert`, every other call as normal. */
  const withUpsert = (upsert: () => Promise<never>): ChipMessageDeps => ({
    ...deps,
    prisma: new Proxy(prisma, {
      get(target, prop) {
        if (prop !== 'chipWebhookEvent') {
          const value = Reflect.get(target, prop) as unknown;
          return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
        }
        const delegate = target.chipWebhookEvent;
        return { upsert, update: delegate.update.bind(delegate) };
      },
    }),
  });

  it('handles and grants the message when the log cannot be written at all', async () => {
    const { pageId, providerRef, paymentId } = await aPendingPayment();
    getPurchase.mockResolvedValue(purchase(providerRef, paymentId));
    const body = { id: providerRef, event_type: 'purchase.paid' };
    const broken = withUpsert(() => Promise.reject(new Error('relation "ChipWebhookEvent" does not exist')));

    expect(await recordAndHandle(broken, { source: 'webhook', body, rawBody: JSON.stringify(body) })).toEqual({ status: 'granted' });

    expect((await prisma.page.findUniqueOrThrow({ where: { id: pageId }, select: { paidUntil: true } })).paidUntil).not.toBeNull();
    expect(await row(providerRef)).toEqual([]);
    expect(log.warn).toHaveBeenCalledWith(
      { purchaseId: providerRef, source: 'webhook', err: 'Error' },
      'chip message not logged; handling it anyway',
    );
  });

  it('counts a delivery that lost the race to create the row as a repeat on that row', async () => {
    const { providerRef, paymentId } = await aPendingPayment();
    getPurchase.mockResolvedValue(purchase(providerRef, paymentId));
    const body = { id: providerRef, event_type: 'purchase.paid' };
    const rawBody = JSON.stringify(body);
    // The other delivery's row, created between this one's look and its insert.
    await prisma.chipWebhookEvent.create({
      data: { source: 'webhook', eventType: 'purchase.paid', purchaseId: providerRef, body: rawBody, lastAttemptAt: new Date() },
    });
    const raced = withUpsert(() => Promise.reject(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })));

    expect(await recordAndHandle(raced, { source: 'webhook', body, rawBody })).toEqual({ status: 'granted' });

    expect(await row(providerRef)).toMatchObject([{ attempts: 2, outcome: 'ok', statusCode: 200 }]);
  });
});
