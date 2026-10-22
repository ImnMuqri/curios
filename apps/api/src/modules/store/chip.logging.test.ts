import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ChipRefusedError, type ChipClient } from '@curios/billing';
import { createSession, SESSION_COOKIE } from '../auth/session.service.js';

/**
 * The owner's CHIP secret key, the box it is sealed in, and CHIP's own response bodies
 * never reach the log: a failure is logged by its name only.
 */
const SECRET = 'owner-secret-that-must-never-be-logged-0123456789';
const BODY = 'chip-body-with-customer@example.com';

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
const lines: string[] = [];
let writeSpy: MockInstance<typeof process.stdout.write>;
let nth = 0;
const from = () => `203.0.120.${(nth++ % 200) + 1}`;

beforeAll(async () => {
  // Before buildApp, so pino writes through process.stdout (see lead.logging.test.ts).
  writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    lines.push(typeof chunk === 'string' ? chunk : String(chunk));
    return true;
  });
  const { buildApp } = await import('../../app.js');
  app = await buildApp({ shopChip: { clientFor: () => client, secretsKey: randomBytes(32), production: true } });
  await app.ready();
});

afterAll(async () => {
  writeSpy.mockRestore();
  await app.close();
});

beforeEach(() => {
  for (const fn of Object.values(client)) fn.mockReset();
  client.listPaymentMethods.mockResolvedValue(['visa', 'razer_tng']);
  client.getPublicKey.mockResolvedValue('-----BEGIN PUBLIC KEY-----\nx\n-----END PUBLIC KEY-----');
  lines.length = 0;
});

async function anOwner() {
  const slug = randomUUID().slice(0, 8);
  const account = await app.prisma.account.create({
    data: {
      email: `chip-log-${randomUUID()}@example.com`,
      pages: { create: { handle: `chl-${slug}`, skeleton: `chl-${slug}`, displayName: 'Kek Lina', mode: 'BUSINESS' } },
    },
    select: { id: true, pages: { select: { id: true } } },
  });
  return { cookie: (await createSession(app.prisma, account.id)).value, pageId: account.pages[0]?.id ?? '' };
}

const call = (method: 'POST' | 'DELETE', url: string, cookie: string, payload?: object) =>
  app.inject({ method, url, remoteAddress: from(), cookies: { [SESSION_COOKIE]: cookie }, ...(payload ? { payload } : {}) });

describe('CHIP connection logs', () => {
  it('never carry the secret key, the sealed box, or a CHIP body', async () => {
    const owner = await anOwner();
    expect((await call('POST', '/store/chip', owner.cookie, { brandId: randomUUID(), secretKey: SECRET })).statusCode).toBe(200);
    const sealed = (await app.prisma.shopPaymentAccount.findUniqueOrThrow({ where: { pageId: owner.pageId } })).secretKeyCiphertext;

    // A test key in production: the purchase is cancelled, and the cancel fails with a body.
    client.createPurchase.mockResolvedValueOnce({
      id: 'p-1', status: 'created', reference: 'Curios test', totalCents: 100, checkoutUrl: 'https://gate.chip-in.asia/p/p-1/',
      isRecurringToken: false, isTest: true, paymentMethod: null, maskedPan: null,
    });
    client.cancelPurchase.mockRejectedValueOnce(new ChipRefusedError(`CHIP refused POST with 400: ${BODY} ${SECRET}`, 400));
    expect((await call('POST', '/store/chip/test', owner.cookie)).statusCode).toBe(400);

    // Something unexpected, carrying a body: a 500 whose log names it and no more.
    client.listPaymentMethods.mockRejectedValueOnce(new Error(`unexpected ${BODY} ${SECRET}`));
    expect((await call('POST', '/store/chip', owner.cookie, { brandId: randomUUID(), secretKey: SECRET })).statusCode).toBe(500);

    // CHIP answering something odd for the test purchase.
    await call('POST', '/store/chip', owner.cookie, { brandId: randomUUID(), secretKey: SECRET });
    client.createPurchase.mockRejectedValueOnce(new ChipRefusedError(`CHIP refused POST with 422: ${BODY}`, 422));
    expect((await call('POST', '/store/chip/test', owner.cookie)).statusCode).toBe(400);

    const all = lines.join('\n');
    expect(all).toContain('test purchase could not be cancelled');
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain(sealed);
    expect(all).not.toContain(BODY);
  });
});
