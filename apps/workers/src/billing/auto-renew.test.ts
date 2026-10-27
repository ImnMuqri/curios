import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { extendPaidUntil } from '@curios/core';
import { defaultSettings, fallbackSettings, type Settings } from '@curios/core/settings';
import { ChipUnavailableError, type ChargeResult, type ChipClient, type ChipPurchase } from '@curios/billing';
import { runAutoRenewals } from './auto-renew.js';
import type { MailQueueLike } from './renewal-reminder.js';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

// The daily run: 10:00 in Kuala Lumpur (UTC+8) on 14 Sep. Today there ends at 16:00 UTC.
const NOW = new Date('2026-09-14T02:00:00.000Z');
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const APP_URL = 'https://curios.example';
const CALLBACK_BASE_URL = 'https://api.curios.example';
const at = (ms: number) => new Date(NOW.getTime() + ms);

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
});

async function aRenewingPage(options: {
  paidUntil: Date;
  failedAttempts?: number;
  lastAttemptAt?: Date | null;
  plan?: 'MONTHLY' | 'ANNUAL';
  suspendedAt?: Date | null;
}) {
  const slug = `ar-${randomUUID().slice(0, 8)}`;
  const token = `tok-${randomUUID()}`;
  const account = await prisma.account.create({
    data: {
      email: `auto-renew-${randomUUID()}@example.com`,
      pages: {
        create: {
          handle: slug,
          skeleton: slug,
          displayName: 'Nadia Bakes',
          mode: 'BUSINESS',
          paidUntil: options.paidUntil,
          suspendedAt: options.suspendedAt ?? null,
          renewalCard: {
            create: {
              token,
              plan: options.plan ?? 'MONTHLY',
              cardLabel: 'Visa ending 1111',
              failedAttempts: options.failedAttempts ?? 0,
              lastAttemptAt: options.lastAttemptAt ?? null,
            },
          },
        },
      },
    },
    select: { email: true, pages: { select: { id: true } } },
  });
  return { pageId: account.pages[0]?.id ?? '', email: account.email, token };
}

/** A renewal payment already in flight, as an earlier run would have left it. */
async function aRenewalPayment(pageId: string, createdAt: Date, providerRef: string | null = `purchase-${randomUUID()}`) {
  return prisma.payment.create({
    data: { pageId, plan: 'MONTHLY', amountCents: 4900, provider: 'CHIP', providerRef, autoRenewal: true, createdAt },
    select: { id: true, providerRef: true },
  });
}

function aPurchase(over: Partial<ChipPurchase> & { id: string }): ChipPurchase {
  return {
    status: 'created',
    reference: '',
    totalCents: 4900,
    checkoutUrl: `https://gate.chip-in.asia/p/${over.id}/`,
    isRecurringToken: false,
    isTest: true,
    paymentMethod: 'visa',
    maskedPan: '411111******1111',
    ...over,
  };
}

/** The purchase CHIP would hand back for a payment of ours, in the given status. */
async function purchaseFor(id: string, status: string): Promise<ChipPurchase> {
  const payment = await prisma.payment.findUniqueOrThrow({
    where: { providerRef: id },
    select: { id: true, amountCents: true },
  });
  return aPurchase({ id, status, reference: payment.id, totalCents: payment.amountCents });
}

/** A CHIP that creates purchases as asked and charges every saved card successfully. */
function aChip() {
  return {
    createPurchase: vi.fn<ChipClient['createPurchase']>(async (input) =>
      aPurchase({ id: `purchase-${randomUUID()}`, reference: input.reference, totalCents: input.amountCents }),
    ),
    getPurchase: vi.fn<ChipClient['getPurchase']>(async (id) => purchaseFor(id, 'paid')),
    chargePurchase: vi.fn<ChipClient['chargePurchase']>(
      async (id): Promise<ChargeResult> => ({ kind: 'paid', purchase: await purchaseFor(id, 'paid') }),
    ),
    deleteRecurringToken: vi.fn<ChipClient['deleteRecurringToken']>(),
    cancelPurchase: vi.fn<ChipClient['cancelPurchase']>(),
    getPublicKey: vi.fn<ChipClient['getPublicKey']>(),
    listPaymentMethods: vi.fn<ChipClient['listPaymentMethods']>(),
  };
}

function aMailQueue() {
  return { add: vi.fn<MailQueueLike['add']>(async () => ({ id: 'queued' })) };
}

function run(
  client: ReturnType<typeof aChip>,
  mailQueue = aMailQueue(),
  extra: {
    afterRead?: () => Promise<void>;
    beforeCharge?: () => Promise<void>;
    afterLapsedRead?: () => Promise<void>;
    now?: Date;
    settings?: { get(): Promise<Settings> };
    log?: { info: (details: object, message: string) => void; error: (details: object, message: string) => void };
  } = {},
) {
  return runAutoRenewals({
    prisma,
    client,
    mailQueue,
    now: NOW,
    appUrl: APP_URL,
    callbackBaseUrl: CALLBACK_BASE_URL,
    settings: { get: async () => defaultSettings() },
    ...extra,
  });
}

const paidUntilOf = async (pageId: string) =>
  (await prisma.page.findUniqueOrThrow({ where: { id: pageId }, select: { paidUntil: true } })).paidUntil;
const renewalsOf = (pageId: string) =>
  prisma.payment.findMany({
    where: { pageId, autoRenewal: true },
    select: { id: true, status: true, providerRef: true, plan: true, amountCents: true },
    orderBy: { createdAt: 'asc' },
  });
const cardOf = (pageId: string) => prisma.renewalCard.findUnique({ where: { pageId } });

describe('runAutoRenewals', () => {
  it('charges the price in force on the day: with price.MONTHLY at 5900, the renewal is 5900', async () => {
    const page = await aRenewingPage({ paidUntil: at(12 * HOUR_MS) });
    const client = aChip();
    const raised = { ...defaultSettings(), prices: { ...defaultSettings().prices, MONTHLY: 5900 } };

    expect(await run(client, aMailQueue(), { settings: { get: async () => raised } })).toMatchObject({ charged: 1 });

    expect(client.createPurchase.mock.calls[0]?.[0]).toMatchObject({ amountCents: 5900 });
    expect(await renewalsOf(page.pageId)).toMatchObject([{ status: 'PAID', amountCents: 5900 }]);
  });

  it('charges a card on the day its plan ends and grants', async () => {
    const paidUntil = at(12 * HOUR_MS);
    const page = await aRenewingPage({ paidUntil });
    const client = aChip();

    expect(await run(client)).toEqual({ charged: 1, pending: 0, failed: 0, stopped: 0 });

    const [payment] = await renewalsOf(page.pageId);
    expect(payment).toMatchObject({ status: 'PAID', plan: 'MONTHLY', amountCents: 4900 });
    expect(client.createPurchase).toHaveBeenCalledTimes(1);
    const input = client.createPurchase.mock.calls[0]?.[0];
    expect(input).toMatchObject({
      email: page.email,
      fullName: 'Nadia Bakes',
      productName: 'Curios Business, 1 month — Nadia Bakes',
      amountCents: 4900,
      reference: payment?.id,
      successCallback: `${CALLBACK_BASE_URL}/billing/chip/callback`,
      sendReceipt: true,
      cardsOnlyRecurring: false,
    });
    expect(input?.redirectUrl).toBeUndefined();
    expect(input?.dueAt).toEqual(at(HOUR_MS));
    expect(client.chargePurchase).toHaveBeenCalledWith(payment?.providerRef, page.token);
    expect(await paidUntilOf(page.pageId)).toEqual(extendPaidUntil({ paidUntil, now: NOW, plan: 'MONTHLY' }));
    expect(await cardOf(page.pageId)).toMatchObject({ lastAttemptAt: NOW });
  });

  it('skips the whole run while CHIP payments are off, and charges on the next run once they are on', async () => {
    const paidUntil = at(12 * HOUR_MS);
    const page = await aRenewingPage({ paidUntil });
    // A lapsed card too: the run that would drop it is skipped as well.
    const lapsed = await aRenewingPage({ paidUntil: at(-4 * DAY_MS) });
    const client = aChip();
    const mailQueue = aMailQueue();
    const log = { info: vi.fn(), error: vi.fn() };
    const off = defaultSettings();
    off.switches.chipPayments = false;

    expect(await run(client, mailQueue, { settings: { get: async () => off }, log })).toEqual({ charged: 0, pending: 0, failed: 0, stopped: 0 });
    expect(client.createPurchase).not.toHaveBeenCalled();
    expect(client.chargePurchase).not.toHaveBeenCalled();
    expect(mailQueue.add).not.toHaveBeenCalled();
    expect(await cardOf(page.pageId)).toMatchObject({ lastAttemptAt: null });
    expect(await cardOf(lapsed.pageId)).not.toBeNull();
    expect(log.info).toHaveBeenCalledWith({}, 'auto-renew skipped: CHIP payments are off');

    expect(await run(client, mailQueue)).toMatchObject({ charged: 1 });
    expect(await paidUntilOf(page.pageId)).toEqual(extendPaidUntil({ paidUntil, now: NOW, plan: 'MONTHLY' }));
  });

  it('skips the run when the settings could not be read, and charges on the next run once they can', async () => {
    const paidUntil = at(12 * HOUR_MS);
    const page = await aRenewingPage({ paidUntil });
    const lapsed = await aRenewingPage({ paidUntil: at(-4 * DAY_MS) });
    const client = aChip();
    const mailQueue = aMailQueue();
    const log = { info: vi.fn(), error: vi.fn() };

    // The defaults may not be the admin's prices: nothing is charged at them.
    expect(await run(client, mailQueue, { settings: { get: async () => fallbackSettings() }, log })).toEqual({ charged: 0, pending: 0, failed: 0, stopped: 0 });
    expect(client.createPurchase).not.toHaveBeenCalled();
    expect(mailQueue.add).not.toHaveBeenCalled();
    expect(await cardOf(page.pageId)).toMatchObject({ lastAttemptAt: null });
    expect(await cardOf(lapsed.pageId)).not.toBeNull();
    expect(log.info).toHaveBeenCalledWith({}, 'auto-renew skipped: the settings could not be read');

    expect(await run(client, mailQueue)).toMatchObject({ charged: 1 });
    expect(await paidUntilOf(page.pageId)).toEqual(extendPaidUntil({ paidUntil, now: NOW, plan: 'MONTHLY' }));
  });

  it('charges no further card once the settings stop being readable mid-run', async () => {
    const first = await aRenewingPage({ paidUntil: at(6 * HOUR_MS) });
    const second = await aRenewingPage({ paidUntil: at(12 * HOUR_MS) });
    const client = aChip();
    let readable = true;
    const charge = client.chargePurchase.getMockImplementation()!;
    client.chargePurchase.mockImplementation(async (id, token) => {
      const result = await charge(id, token);
      readable = false;
      return result;
    });
    const settings = { get: async () => (readable ? defaultSettings() : fallbackSettings()) };

    expect(await run(client, aMailQueue(), { settings })).toEqual({ charged: 1, pending: 0, failed: 0, stopped: 0 });
    expect(await renewalsOf(first.pageId)).toHaveLength(1);
    expect(await renewalsOf(second.pageId)).toEqual([]);
    expect(await cardOf(second.pageId)).toMatchObject({ lastAttemptAt: null });
  });

  it('charges no further card once CHIP payments are turned off mid-run, and charges it on the next run', async () => {
    const first = await aRenewingPage({ paidUntil: at(6 * HOUR_MS) });
    const second = await aRenewingPage({ paidUntil: at(12 * HOUR_MS) });
    const client = aChip();
    // The switch goes off once the first card has been charged.
    let on = true;
    const charge = client.chargePurchase.getMockImplementation()!;
    client.chargePurchase.mockImplementation(async (id, token) => {
      const result = await charge(id, token);
      on = false;
      return result;
    });
    const settings = {
      get: async () => {
        const s = defaultSettings();
        s.switches.chipPayments = on;
        return s;
      },
    };
    const log = { info: vi.fn(), error: vi.fn() };

    expect(await run(client, aMailQueue(), { settings, log })).toEqual({ charged: 1, pending: 0, failed: 0, stopped: 0 });
    expect(client.chargePurchase).toHaveBeenCalledTimes(1);
    expect(await renewalsOf(first.pageId)).toHaveLength(1);
    // Not claimed, not even a purchase: the next run takes it as if this one never reached it.
    expect(await renewalsOf(second.pageId)).toEqual([]);
    expect(await cardOf(second.pageId)).toMatchObject({ lastAttemptAt: null });
    expect(log.info).toHaveBeenCalledWith({}, 'auto-renew stopped: CHIP payments were turned off');

    on = true;
    expect(await run(client, aMailQueue(), { settings })).toMatchObject({ charged: 1 });
    expect(await renewalsOf(second.pageId)).toHaveLength(1);
  });

  it('does not charge a suspended page, and charges it once it is back', async () => {
    const page = await aRenewingPage({ paidUntil: at(12 * HOUR_MS), suspendedAt: at(-DAY_MS) });
    const client = aChip();

    expect(await run(client)).toEqual({ charged: 0, pending: 0, failed: 0, stopped: 0 });
    expect(client.createPurchase).not.toHaveBeenCalled();
    expect(await cardOf(page.pageId)).toMatchObject({ lastAttemptAt: null });

    await prisma.page.update({ where: { id: page.pageId }, data: { suspendedAt: null } });
    expect(await run(client)).toMatchObject({ charged: 1 });
  });

  it('does not charge a page suspended after the read', async () => {
    const page = await aRenewingPage({ paidUntil: at(12 * HOUR_MS) });
    const client = aChip();

    await run(client, aMailQueue(), {
      afterRead: async () => {
        await prisma.page.update({ where: { id: page.pageId }, data: { suspendedAt: NOW } });
      },
    });

    expect(client.createPurchase).not.toHaveBeenCalled();
    expect(await renewalsOf(page.pageId)).toEqual([]);
  });

  it('keeps a suspended page’s card past the grace, and tells nobody', async () => {
    const page = await aRenewingPage({ paidUntil: at(-4 * DAY_MS), suspendedAt: at(-5 * DAY_MS) });
    const client = aChip();
    const mailQueue = aMailQueue();

    expect(await run(client, mailQueue)).toMatchObject({ stopped: 0 });
    expect(await cardOf(page.pageId)).not.toBeNull();
    expect(mailQueue.add).not.toHaveBeenCalled();
  });

  it('charges the plan the card was saved for', async () => {
    const page = await aRenewingPage({ paidUntil: at(12 * HOUR_MS), plan: 'ANNUAL' });
    const client = aChip();

    await run(client);

    expect(await renewalsOf(page.pageId)).toMatchObject([{ status: 'PAID', plan: 'ANNUAL', amountCents: 49000 }]);
    expect(client.createPurchase.mock.calls[0]?.[0].productName).toBe('Curios Business, 1 year — Nadia Bakes');
  });

  it('charges up to 3 days after paidUntil', async () => {
    const page = await aRenewingPage({ paidUntil: at(-2.5 * DAY_MS) });
    const client = aChip();

    expect(await run(client)).toMatchObject({ charged: 1 });
    expect(await renewalsOf(page.pageId)).toMatchObject([{ status: 'PAID' }]);
  });

  it('leaves a card alone a week before', async () => {
    await aRenewingPage({ paidUntil: at(7 * DAY_MS) });
    const client = aChip();

    expect(await run(client)).toEqual({ charged: 0, pending: 0, failed: 0, stopped: 0 });
    expect(client.createPurchase).not.toHaveBeenCalled();
  });

  it('leaves a card alone more than 3 days after paidUntil', async () => {
    await aRenewingPage({ paidUntil: at(-4 * DAY_MS) });
    const client = aChip();

    await run(client);

    expect(client.createPurchase).not.toHaveBeenCalled();
  });

  describe('on the Kuala Lumpur day the plan ends, the date Billing states', () => {
    it('does not charge a plan ending tomorrow at 09:00', async () => {
      await aRenewingPage({ paidUntil: new Date('2026-09-15T09:00:00+08:00') });
      const client = aChip();

      await run(client);

      expect(client.createPurchase).not.toHaveBeenCalled();
    });

    it('charges a plan that ended at 09:00 today, at the 10:00 run', async () => {
      await aRenewingPage({ paidUntil: new Date('2026-09-14T09:00:00+08:00') });
      const client = aChip();

      expect(await run(client)).toMatchObject({ charged: 1 });
    });

    it('charges a plan ending at 23:00 today', async () => {
      await aRenewingPage({ paidUntil: new Date('2026-09-14T23:00:00+08:00') });
      const client = aChip();

      expect(await run(client)).toMatchObject({ charged: 1 });
    });

    it('charges a plan ending at the last moment of today, and not one ending at midnight', async () => {
      const last = await aRenewingPage({ paidUntil: new Date('2026-09-14T23:59:59.999+08:00') });
      const midnight = await aRenewingPage({ paidUntil: new Date('2026-09-15T00:00:00+08:00') });
      const client = aChip();

      await run(client);

      expect(await renewalsOf(last.pageId)).toMatchObject([{ status: 'PAID' }]);
      expect(await renewalsOf(midnight.pageId)).toHaveLength(0);
    });
  });

  it('does not charge a card whose plan ended exactly 3 days ago', async () => {
    await aRenewingPage({ paidUntil: at(-3 * DAY_MS) });
    const client = aChip();

    await run(client);

    expect(client.createPurchase).not.toHaveBeenCalled();
  });

  it('does not charge a page that paid at checkout after the read', async () => {
    const page = await aRenewingPage({ paidUntil: at(12 * HOUR_MS) });
    const client = aChip();

    await run(client, aMailQueue(), {
      afterRead: async () => {
        await prisma.page.update({ where: { id: page.pageId }, data: { paidUntil: at(30 * DAY_MS) } });
      },
    });

    expect(client.createPurchase).not.toHaveBeenCalled();
    expect(await cardOf(page.pageId)).toMatchObject({ lastAttemptAt: null });
  });

  it('charges once when two runs race', async () => {
    const page = await aRenewingPage({ paidUntil: at(12 * HOUR_MS) });
    const client = aChip();

    await Promise.all([run(client), run(client)]);

    expect(client.chargePurchase).toHaveBeenCalledTimes(1);
    expect(await renewalsOf(page.pageId)).toHaveLength(1);
  });

  it('does not charge again on a second run the same day', async () => {
    await aRenewingPage({ paidUntil: at(12 * HOUR_MS), lastAttemptAt: at(-10 * HOUR_MS) });
    const client = aChip();

    await run(client);

    expect(client.createPurchase).not.toHaveBeenCalled();
  });

  it('skips a page with a renewal still pending', async () => {
    const page = await aRenewingPage({ paidUntil: at(12 * HOUR_MS) });
    await aRenewalPayment(page.pageId, at(-30 * 60_000));
    const client = aChip();

    await run(client);

    expect(client.getPurchase).not.toHaveBeenCalled();
    expect(client.createPurchase).not.toHaveBeenCalled();
    expect(client.chargePurchase).not.toHaveBeenCalled();
    expect(await cardOf(page.pageId)).toMatchObject({ lastAttemptAt: null });
  });

  it('does not charge a card deleted after the read', async () => {
    const page = await aRenewingPage({ paidUntil: at(12 * HOUR_MS) });
    const client = aChip();

    await run(client, aMailQueue(), {
      afterRead: async () => {
        await prisma.renewalCard.delete({ where: { pageId: page.pageId } });
      },
    });

    expect(client.createPurchase).not.toHaveBeenCalled();
    expect(client.chargePurchase).not.toHaveBeenCalled();
    expect(await renewalsOf(page.pageId)).toHaveLength(0);
  });

  it('does not charge the old card when the owner saved a new one after the read', async () => {
    const page = await aRenewingPage({ paidUntil: at(12 * HOUR_MS) });
    const client = aChip();

    await run(client, aMailQueue(), {
      afterRead: async () => {
        await prisma.renewalCard.update({ where: { pageId: page.pageId }, data: { token: 'tok-new' } });
      },
    });

    expect(client.chargePurchase).not.toHaveBeenCalled();
  });

  it('does not charge a card turned off between the purchase and the charge', async () => {
    const page = await aRenewingPage({ paidUntil: at(12 * HOUR_MS) });
    const client = aChip();

    await run(client, aMailQueue(), {
      beforeCharge: async () => {
        await prisma.renewalCard.delete({ where: { pageId: page.pageId } });
      },
    });

    expect(client.chargePurchase).not.toHaveBeenCalled();
    const [payment] = await renewalsOf(page.pageId);
    expect(payment).toMatchObject({ status: 'EXPIRED' });
    expect(client.cancelPurchase).toHaveBeenCalledWith(payment?.providerRef);
  });

  it(`a decline counts a failure and mails "we'll try again tomorrow"`, async () => {
    const page = await aRenewingPage({ paidUntil: at(12 * HOUR_MS) });
    const client = aChip();
    client.chargePurchase.mockResolvedValue({ kind: 'declined' });
    const mailQueue = aMailQueue();

    expect(await run(client, mailQueue)).toEqual({ charged: 0, pending: 0, failed: 1, stopped: 0 });

    expect(await renewalsOf(page.pageId)).toMatchObject([{ status: 'FAILED' }]);
    expect(await cardOf(page.pageId)).toMatchObject({ failedAttempts: 1, lastFailedAt: NOW });
    const [, mail] = mailQueue.add.mock.calls[0] ?? [];
    expect(mail?.to).toBe(page.email);
    expect(mail?.text).toContain("We'll try again tomorrow.");
  });

  it('a third decline stops auto-renew and mails it', async () => {
    const page = await aRenewingPage({
      paidUntil: at(-2 * DAY_MS),
      failedAttempts: 2,
      lastAttemptAt: at(-25 * HOUR_MS),
    });
    const client = aChip();
    client.chargePurchase.mockResolvedValue({ kind: 'declined' });
    const mailQueue = aMailQueue();

    expect(await run(client, mailQueue)).toEqual({ charged: 0, pending: 0, failed: 0, stopped: 1 });

    expect(await cardOf(page.pageId)).toBeNull();
    const [, mail] = mailQueue.add.mock.calls[0] ?? [];
    expect(mail?.subject).toBe('Auto-renew is off for Nadia Bakes');
    expect(mail?.text).toContain("We couldn't charge your card after 3 tries");
  });

  it('an invalid token deletes the card and mails card-removed', async () => {
    const page = await aRenewingPage({ paidUntil: at(12 * HOUR_MS) });
    const client = aChip();
    client.chargePurchase.mockResolvedValue({ kind: 'invalid-token' });
    const mailQueue = aMailQueue();

    expect(await run(client, mailQueue)).toEqual({ charged: 0, pending: 0, failed: 0, stopped: 1 });

    expect(await cardOf(page.pageId)).toBeNull();
    expect(await renewalsOf(page.pageId)).toMatchObject([{ status: 'FAILED' }]);
    const [, mail] = mailQueue.add.mock.calls[0] ?? [];
    expect(mail?.to).toBe(page.email);
    expect(mail?.text).toContain('Your saved card can no longer be charged');
  });

  it('a charge CHIP is still processing stays pending for the webhook', async () => {
    const page = await aRenewingPage({ paidUntil: at(12 * HOUR_MS) });
    const client = aChip();
    client.chargePurchase.mockImplementation(async (id) => ({
      kind: 'pending',
      purchase: await purchaseFor(id, 'pending_charge'),
    }));

    expect(await run(client)).toEqual({ charged: 0, pending: 1, failed: 0, stopped: 0 });
    expect(await renewalsOf(page.pageId)).toMatchObject([{ status: 'PENDING' }]);
  });

  it('CHIP down leaves the payment pending and claims the day', async () => {
    const page = await aRenewingPage({ paidUntil: at(12 * HOUR_MS) });
    const client = aChip();
    client.chargePurchase.mockRejectedValue(new ChipUnavailableError('timeout'));

    expect(await run(client)).toEqual({ charged: 0, pending: 1, failed: 0, stopped: 0 });

    expect(await renewalsOf(page.pageId)).toMatchObject([{ status: 'PENDING' }]);
    expect(await cardOf(page.pageId)).toMatchObject({ lastAttemptAt: NOW, failedAttempts: 0 });
    // The card may have been charged all the same: a second run never charges over it.
    await run(client);
    expect(client.chargePurchase).toHaveBeenCalledTimes(1);
  });

  describe('a renewal left pending by an earlier run', () => {
    it('is granted when CHIP says it was paid, and nothing new is charged', async () => {
      const paidUntil = at(-20 * HOUR_MS);
      const page = await aRenewingPage({ paidUntil, lastAttemptAt: at(-26 * HOUR_MS) });
      const stuck = await aRenewalPayment(page.pageId, at(-26 * HOUR_MS));
      const client = aChip();

      expect(await run(client)).toMatchObject({ charged: 1 });

      expect(client.getPurchase).toHaveBeenCalledWith(stuck.providerRef);
      expect(client.createPurchase).not.toHaveBeenCalled();
      expect(await renewalsOf(page.pageId)).toMatchObject([{ id: stuck.id, status: 'PAID' }]);
      expect(await paidUntilOf(page.pageId)).toEqual(extendPaidUntil({ paidUntil, now: NOW, plan: 'MONTHLY' }));
    });

    it('is granted when CHIP says it was paid and has since settled, and nothing new is charged', async () => {
      const page = await aRenewingPage({ paidUntil: at(-20 * HOUR_MS), lastAttemptAt: at(-26 * HOUR_MS) });
      const stuck = await aRenewalPayment(page.pageId, at(-26 * HOUR_MS));
      const client = aChip();
      client.getPurchase.mockImplementation(async (id) => purchaseFor(id, 'settled'));

      expect(await run(client)).toMatchObject({ charged: 1 });

      expect(client.chargePurchase).not.toHaveBeenCalled();
      expect(await renewalsOf(page.pageId)).toMatchObject([{ id: stuck.id, status: 'PAID' }]);
    });

    it('counts as a failure when CHIP says it is dead, then a fresh charge is tried', async () => {
      const page = await aRenewingPage({ paidUntil: at(-20 * HOUR_MS), lastAttemptAt: at(-26 * HOUR_MS) });
      const stuck = await aRenewalPayment(page.pageId, at(-26 * HOUR_MS));
      const client = aChip();
      client.getPurchase.mockImplementation(async (id) => purchaseFor(id, 'expired'));
      const mailQueue = aMailQueue();

      expect(await run(client, mailQueue)).toEqual({ charged: 1, pending: 0, failed: 1, stopped: 0 });

      expect(await renewalsOf(page.pageId)).toMatchObject([
        { id: stuck.id, status: 'FAILED' },
        { status: 'PAID' },
      ]);
      // Renewed in the same run: there is no failure to tell the owner about.
      expect(mailQueue.add).not.toHaveBeenCalled();
    });

    it('mails once, with the final count, when the fresh charge is declined too', async () => {
      const page = await aRenewingPage({ paidUntil: at(-20 * HOUR_MS), lastAttemptAt: at(-26 * HOUR_MS) });
      await aRenewalPayment(page.pageId, at(-26 * HOUR_MS));
      const client = aChip();
      client.getPurchase.mockImplementation(async (id) => purchaseFor(id, 'expired'));
      client.chargePurchase.mockResolvedValue({ kind: 'declined' });
      const mailQueue = aMailQueue();

      expect(await run(client, mailQueue)).toEqual({ charged: 0, pending: 0, failed: 2, stopped: 0 });

      expect(mailQueue.add).toHaveBeenCalledTimes(1);
      expect(mailQueue.add.mock.calls[0]?.[1].text).toContain("We'll try again tomorrow.");
      expect(await cardOf(page.pageId)).toMatchObject({ failedAttempts: 2 });
    });

    it('mails the counted failure when no fresh charge can be made today', async () => {
      const page = await aRenewingPage({ paidUntil: at(-20 * HOUR_MS), lastAttemptAt: at(-3 * HOUR_MS) });
      await aRenewalPayment(page.pageId, at(-3 * HOUR_MS));
      const client = aChip();
      client.getPurchase.mockImplementation(async (id) => purchaseFor(id, 'expired'));
      const mailQueue = aMailQueue();

      expect(await run(client, mailQueue)).toEqual({ charged: 0, pending: 0, failed: 1, stopped: 0 });

      expect(client.createPurchase).not.toHaveBeenCalled();
      expect(mailQueue.add).toHaveBeenCalledTimes(1);
      expect(mailQueue.add.mock.calls[0]?.[1].text).toContain("We'll try again tomorrow.");
    });

    it('mails at once when the counted failure stops auto-renew', async () => {
      const page = await aRenewingPage({
        paidUntil: at(-20 * HOUR_MS),
        failedAttempts: 2,
        lastAttemptAt: at(-26 * HOUR_MS),
      });
      await aRenewalPayment(page.pageId, at(-26 * HOUR_MS));
      const client = aChip();
      client.getPurchase.mockImplementation(async (id) => purchaseFor(id, 'expired'));
      const mailQueue = aMailQueue();

      expect(await run(client, mailQueue)).toEqual({ charged: 0, pending: 0, failed: 0, stopped: 1 });

      expect(client.createPurchase).not.toHaveBeenCalled();
      expect(mailQueue.add).toHaveBeenCalledTimes(1);
      expect(mailQueue.add.mock.calls[0]?.[1].text).toContain("We couldn't charge your card after 3 tries");
    });

    it('holds the page while CHIP is still working on it', async () => {
      const page = await aRenewingPage({ paidUntil: at(-20 * HOUR_MS), lastAttemptAt: at(-26 * HOUR_MS) });
      await aRenewalPayment(page.pageId, at(-26 * HOUR_MS));
      const client = aChip();
      client.getPurchase.mockImplementation(async (id) => purchaseFor(id, 'pending_charge'));

      await run(client);

      expect(client.createPurchase).not.toHaveBeenCalled();
      expect(await renewalsOf(page.pageId)).toMatchObject([{ status: 'PENDING' }]);
    });

    it('holds the page when CHIP cannot be asked', async () => {
      const page = await aRenewingPage({ paidUntil: at(-20 * HOUR_MS), lastAttemptAt: at(-26 * HOUR_MS) });
      await aRenewalPayment(page.pageId, at(-26 * HOUR_MS));
      const client = aChip();
      client.getPurchase.mockRejectedValue(new ChipUnavailableError('timeout'));

      await run(client);

      expect(client.createPurchase).not.toHaveBeenCalled();
    });

    it('is expired when it never reached CHIP, and a fresh charge is tried', async () => {
      const page = await aRenewingPage({ paidUntil: at(-20 * HOUR_MS), lastAttemptAt: at(-26 * HOUR_MS) });
      const orphan = await aRenewalPayment(page.pageId, at(-26 * HOUR_MS), null);
      const client = aChip();

      expect(await run(client)).toMatchObject({ charged: 1 });

      expect(client.getPurchase).not.toHaveBeenCalled();
      expect(await renewalsOf(page.pageId)).toMatchObject([
        { id: orphan.id, status: 'EXPIRED' },
        { status: 'PAID' },
      ]);
    });
  });

  it('a purchase CHIP will not create leaves a harmless row and claims the day', async () => {
    const page = await aRenewingPage({ paidUntil: at(12 * HOUR_MS) });
    const client = aChip();
    client.createPurchase.mockRejectedValue(new ChipUnavailableError('timeout'));

    expect(await run(client)).toEqual({ charged: 0, pending: 0, failed: 0, stopped: 0 });

    expect(await renewalsOf(page.pageId)).toMatchObject([{ status: 'PENDING', providerRef: null }]);
    expect(client.chargePurchase).not.toHaveBeenCalled();
    expect(await cardOf(page.pageId)).toMatchObject({ lastAttemptAt: NOW });
  });

  describe('a card whose plan ran out past the grace', () => {
    it('is dropped, and the owner told once, when CHIP was unreachable all through the window', async () => {
      const page = await aRenewingPage({ paidUntil: at(12 * HOUR_MS) });
      const client = aChip();
      client.chargePurchase.mockRejectedValue(new ChipUnavailableError('timeout'));
      client.getPurchase.mockRejectedValue(new ChipUnavailableError('timeout'));
      const mailQueue = aMailQueue();

      // One run a day, from the day the plan ends to past the grace.
      for (const day of [0, 1, 2, 3, 4]) {
        await run(client, mailQueue, { now: at(day * DAY_MS) });
      }

      expect(client.chargePurchase).toHaveBeenCalledTimes(1);
      expect(await cardOf(page.pageId)).toBeNull();
      expect(mailQueue.add).toHaveBeenCalledTimes(1);
      const [, mail] = mailQueue.add.mock.calls[0] ?? [];
      expect(mail?.to).toBe(page.email);
      expect(mail?.subject).toBe('Auto-renew is off for Nadia Bakes');
      expect(mail?.text).toContain("We couldn't renew your plan before it ran out");
      // The charge CHIP may yet settle is left for its webhook.
      expect(await renewalsOf(page.pageId)).toMatchObject([{ status: 'PENDING' }]);

      await run(client, mailQueue, { now: at(5 * DAY_MS) });
      expect(mailQueue.add).toHaveBeenCalledTimes(1);
    });

    it('is dropped from exactly 3 days after the plan ended', async () => {
      const page = await aRenewingPage({ paidUntil: at(-3 * DAY_MS) });
      const mailQueue = aMailQueue();

      expect(await run(aChip(), mailQueue)).toMatchObject({ stopped: 1 });

      expect(await cardOf(page.pageId)).toBeNull();
      expect(mailQueue.add.mock.calls[0]?.[1].text).toContain("We couldn't renew your plan before it ran out");
    });

    it('keeps the card of a page a webhook renewed during the sweep', async () => {
      const page = await aRenewingPage({ paidUntil: at(-4 * DAY_MS) });
      const mailQueue = aMailQueue();

      await run(aChip(), mailQueue, {
        afterLapsedRead: async () => {
          // A renewal CHIP settled late is granted by its webhook between the read and the drop.
          await prisma.page.update({ where: { id: page.pageId }, data: { paidUntil: at(26 * DAY_MS) } });
        },
      });

      expect(await cardOf(page.pageId)).not.toBeNull();
      expect(mailQueue.add).not.toHaveBeenCalled();
    });

    it('leaves a personal page alone', async () => {
      const page = await aRenewingPage({ paidUntil: at(-5 * DAY_MS) });
      await prisma.page.update({ where: { id: page.pageId }, data: { mode: 'PERSONAL' } });
      const mailQueue = aMailQueue();

      await run(aChip(), mailQueue);

      expect(await cardOf(page.pageId)).not.toBeNull();
      expect(mailQueue.add).not.toHaveBeenCalled();
    });
  });

  it('one page failing does not stop the rest', async () => {
    const first = await aRenewingPage({ paidUntil: at(6 * HOUR_MS) });
    const second = await aRenewingPage({ paidUntil: at(12 * HOUR_MS) });
    const client = aChip();
    client.createPurchase.mockRejectedValueOnce(new Error('CHIP refused POST /purchases/ with 400'));

    expect(await run(client)).toMatchObject({ charged: 1 });
    expect(await renewalsOf(first.pageId)).toMatchObject([{ status: 'PENDING' }]);
    expect(await renewalsOf(second.pageId)).toMatchObject([{ status: 'PAID' }]);
  });
});
