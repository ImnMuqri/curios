import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ChipClient } from '@curios/billing';
import { createSession, SESSION_COOKIE } from '../auth/session.service.js';

/**
 * A refused CHIP call carries CHIP's response body in its message, and that body holds the
 * payer's email and name. What reaches the log is the error's name, never its message.
 */
const BODY_EMAIL = 'payer-secret@example.com';
const refused = () => new Error(`CHIP refused POST with 400: {"client":{"email":"${BODY_EMAIL}"}}`);

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
const from = () => `203.0.118.${(nth++ % 200) + 1}`;

beforeAll(async () => {
  // Before buildApp, so pino writes through process.stdout (see lead.logging.test.ts).
  writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    lines.push(typeof chunk === 'string' ? chunk : String(chunk));
    return true;
  });
  const { buildApp } = await import('../../app.js');
  app = await buildApp({ billing: { client } });
  await app.ready();
});

afterAll(async () => {
  writeSpy.mockRestore();
  await app.close();
});

beforeEach(() => {
  for (const fn of Object.values(client)) fn.mockReset();
  lines.length = 0;
});

async function anOwner() {
  const slug = randomUUID().slice(0, 8);
  const account = await app.prisma.account.create({
    data: {
      email: `billing-log-${randomUUID()}@example.com`,
      pages: { create: { handle: `blg-${slug}`, skeleton: `blg-${slug}`, displayName: 'Nadia Bakes', mode: 'BUSINESS' } },
    },
    select: { id: true, pages: { select: { id: true } } },
  });
  const { value } = await createSession(app.prisma, account.id);
  return { cookie: value, pageId: account.pages[0]?.id ?? '' };
}

/** The log line carrying `msg`, parsed. */
function logged(msg: string): Record<string, unknown> | undefined {
  const line = lines.find((l) => l.includes(msg));
  return line ? (JSON.parse(line) as Record<string, unknown>) : undefined;
}

describe('billing logs', () => {
  it('turning auto-renew off logs only the name of a CHIP refusal', async () => {
    const owner = await anOwner();
    await app.prisma.renewalCard.create({ data: { pageId: owner.pageId, token: `tok-${randomUUID()}`, plan: 'MONTHLY' } });
    client.deleteRecurringToken.mockRejectedValue(refused());

    const res = await app.inject({
      method: 'POST',
      url: '/billing/auto-renew/off',
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: owner.cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(logged('CHIP could not be told to forget the card')).toMatchObject({ pageId: owner.pageId, err: 'Error' });
    expect(lines.join('')).not.toContain(BODY_EMAIL);
  });

  it('the return logs only the name of a CHIP refusal', async () => {
    const owner = await anOwner();
    const providerRef = `purchase-${randomUUID()}`;
    const payment = await app.prisma.payment.create({
      data: { pageId: owner.pageId, plan: 'MONTHLY', amountCents: 4900, provider: 'CHIP', providerRef },
      select: { id: true },
    });
    client.getPurchase.mockRejectedValue(refused());

    const res = await app.inject({ method: 'GET', url: `/billing/chip/return?payment=${payment.id}`, remoteAddress: from() });

    expect(res.headers.location).toMatch(/payment=pending$/);
    expect(logged('chip purchase could not be confirmed')).toMatchObject({ purchaseId: providerRef, err: 'Error' });
    expect(lines.join('')).not.toContain(BODY_EMAIL);
  });
});
