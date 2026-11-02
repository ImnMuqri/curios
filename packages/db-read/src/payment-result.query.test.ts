import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getPaymentResult } from './payment-result.query.js';

const write = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

let pageId = '';
let otherPageId = '';
let paymentId = '';
let pendingId = '';

beforeAll(async () => {
  await write.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
  const account = await write.account.create({
    data: {
      email: 'payresult@example.com',
      pages: { create: { handle: 'payresult', skeleton: 'payresult', displayName: 'Nadia Bakes' } },
    },
    select: { pages: { select: { id: true } } },
  });
  pageId = account.pages[0]?.id ?? '';
  const other = await write.account.create({
    data: {
      email: 'payresult-other@example.com',
      pages: { create: { handle: 'payres-other', skeleton: 'payresother', displayName: 'Someone Else' } },
    },
    select: { pages: { select: { id: true } } },
  });
  otherPageId = other.pages[0]?.id ?? '';

  const paid = await write.payment.create({
    data: {
      pageId,
      plan: 'MONTHLY',
      amountCents: 4900,
      provider: 'CHIP',
      providerRef: 'a1b2c3d4-0000-4000-8000-payresult01',
      status: 'PAID',
      paidVia: 'FPX · Maybank2u',
      autoRenew: true,
      paidAt: new Date(Date.UTC(2026, 10, 2)),
      grantedUntil: new Date(Date.UTC(2026, 11, 14)),
    },
    select: { id: true },
  });
  paymentId = paid.id;
  const pending = await write.payment.create({ data: { pageId, plan: 'ANNUAL', amountCents: 49000, provider: 'CHIP' }, select: { id: true } });
  pendingId = pending.id;
});

afterAll(async () => {
  // Payments outlive their page (SetNull), so the truncate above does not reach them.
  await write.payment.deleteMany({ where: { id: { in: [paymentId, pendingId] } } });
  await write.$disconnect();
});

describe('getPaymentResult', () => {
  it('carries what the result pages print, with a short upper-case reference', async () => {
    expect(await getPaymentResult(pageId, paymentId)).toEqual({
      plan: 'MONTHLY',
      amountCents: 4900,
      status: 'PAID',
      paidVia: 'FPX · Maybank2u',
      reference: 'A1B2C3D4',
      grantedUntil: new Date(Date.UTC(2026, 11, 14)),
      autoRenew: true,
    });
  });

  it('has no reference, method or date for a payment that never reached CHIP', async () => {
    expect(await getPaymentResult(pageId, pendingId)).toMatchObject({ status: 'PENDING', paidVia: null, reference: null, grantedUntil: null });
  });

  it('is null for another page’s payment, and for an id that does not exist', async () => {
    expect(await getPaymentResult(otherPageId, paymentId)).toBeNull();
    expect(await getPaymentResult(pageId, 'nope')).toBeNull();
  });
});
