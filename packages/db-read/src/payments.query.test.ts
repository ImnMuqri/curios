import { beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getRecentPayments, getRenewalCard, RECENT_PAYMENTS } from './payments.query.js';

const write = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

let pageId = '';
let otherPageId = '';

beforeAll(async () => {
  await write.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
  const account = await write.account.create({
    data: {
      email: 'payments@example.com',
      pages: { create: { handle: 'payments', skeleton: 'payments', displayName: 'Nadia Bakes' } },
    },
    select: { pages: { select: { id: true } } },
  });
  pageId = account.pages[0]?.id ?? '';

  const other = await write.account.create({
    data: {
      email: 'payments-other@example.com',
      pages: { create: { handle: 'pay-other', skeleton: 'payother', displayName: 'Someone Else' } },
    },
    select: { pages: { select: { id: true } } },
  });
  otherPageId = other.pages[0]?.id ?? '';

  // Seven, so the clamp has something to cut, with distinct createdAt values so
  // "newest first" is a fact about the query and not about insertion order.
  for (let index = 0; index < 7; index += 1) {
    await write.payment.create({
      data: {
        pageId,
        plan: 'MONTHLY',
        amountCents: 3900,
        provider: 'CHIP',
        providerRef: `purchase-${pageId}-${index}`,
        status: 'PAID',
        paidAt: new Date(Date.UTC(2026, 2, index + 1)),
        grantedUntil: new Date(Date.UTC(2026, 3, index + 1)),
        createdAt: new Date(Date.UTC(2026, 2, index + 1)),
      },
    });
  }

  await write.payment.create({
    data: {
      pageId: otherPageId,
      plan: 'ANNUAL',
      amountCents: 39000,
      provider: 'CHIP',
      status: 'PAID',
      paidAt: new Date(Date.UTC(2026, 5, 1)),
      createdAt: new Date(Date.UTC(2026, 5, 1)),
    },
  });
});

describe('getRecentPayments', () => {
  it('returns the newest first, and no more than the screen shows', async () => {
    const payments = await getRecentPayments(pageId);

    expect(payments).toHaveLength(RECENT_PAYMENTS);
    expect(payments.map((payment) => payment.createdAt)).toEqual([
      new Date(Date.UTC(2026, 2, 7)),
      new Date(Date.UTC(2026, 2, 6)),
      new Date(Date.UTC(2026, 2, 5)),
      new Date(Date.UTC(2026, 2, 4)),
      new Date(Date.UTC(2026, 2, 3)),
    ]);
  });

  it('carries what the screen prints, and nothing more', async () => {
    const [newest] = await getRecentPayments(pageId);

    expect(newest).toEqual({
      id: expect.any(String),
      plan: 'MONTHLY',
      amountCents: 3900,
      provider: 'CHIP',
      autoRenewal: false,
      status: 'PAID',
      paidAt: new Date(Date.UTC(2026, 2, 7)),
      grantedUntil: new Date(Date.UTC(2026, 3, 7)),
      createdAt: new Date(Date.UTC(2026, 2, 7)),
    });
  });

  it('never returns another pageâ€™s payments', async () => {
    // What someone paid is theirs. This is the same scoping rule the leads query
    // carries, for the same reason.
    const payments = await getRecentPayments(pageId);

    expect(payments.every((payment) => payment.amountCents === 3900)).toBe(true);
    expect(await getRecentPayments(otherPageId)).toHaveLength(1);
  });
});

describe('getRenewalCard', () => {
  it('answers the page’s card, and never the token', async () => {
    await write.renewalCard.create({
      data: { pageId, token: 'secret-recurring-token', plan: 'ANNUAL', cardLabel: 'Visa ending 4242', failedAttempts: 1 },
    });

    const card = await getRenewalCard(pageId);

    // Exactly these three: the token is a credential and must not reach the web app.
    expect(card).toEqual({ cardLabel: 'Visa ending 4242', plan: 'ANNUAL', failedAttempts: 1 });
  });

  it('answers null for a page with no saved card, and never another page’s', async () => {
    expect(await getRenewalCard(otherPageId)).toBeNull();
  });
});
