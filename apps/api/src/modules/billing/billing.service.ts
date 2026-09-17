import { PLAN_PRICES_CENTS, type BillingPlan } from '@curios/core';
import type { PrismaClient } from '@curios/db';
import type { BillplzClient } from '@curios/billing';
import { NoPageError } from '../pages/page.service.js';

export interface BillingConfig {
  collectionId: string;
  callbackUrl: string;
  redirectUrl: string;
}

export class NotABusinessPageError extends Error {
  readonly statusCode = 400;
  readonly code = 'NOT_A_BUSINESS_PAGE';
  constructor() {
    super('Only business pages have a paid plan. Personal pages are free.');
    this.name = 'NotABusinessPageError';
  }
}

/** Billplz caps a description at 200 characters, and a long shop name must not fail the bill. */
export function billDescription(plan: BillingPlan, displayName: string): string {
  return `Curios Business, ${plan === 'ANNUAL' ? '1 year' : '1 month'} — ${displayName}`.slice(0, 200);
}

/**
 * Starts a payment for the signed-in owner's page.
 *
 * The Payment row is created before Billplz is called, so its id can be the bill's
 * reference_1 -- the field a fetched bill is later checked against. If Billplz fails,
 * that row stays PENDING with no bill id, which is harmless: no bill can ever match it,
 * and the hourly check skips rows without one.
 */
export async function createBillForOwner(
  deps: { prisma: PrismaClient; client: BillplzClient; config: BillingConfig },
  input: { accountId: string; plan: BillingPlan },
): Promise<{ url: string }> {
  const page = await deps.prisma.page.findUnique({
    where: { accountId: input.accountId },
    select: { id: true, mode: true, displayName: true, account: { select: { email: true } } },
  });
  if (!page) throw new NoPageError();
  if (page.mode !== 'BUSINESS') throw new NotABusinessPageError();

  const amountCents = PLAN_PRICES_CENTS[input.plan];
  const payment = await deps.prisma.payment.create({
    data: {
      pageId: page.id,
      plan: input.plan,
      amountCents,
      billplzCollectionId: deps.config.collectionId,
    },
    select: { id: true },
  });

  const bill = await deps.client.createBill({
    collectionId: deps.config.collectionId,
    email: page.account.email,
    // Billplz caps the name at 255 characters.
    name: page.displayName.slice(0, 255),
    amountCents,
    description: billDescription(input.plan, page.displayName),
    callbackUrl: deps.config.callbackUrl,
    redirectUrl: deps.config.redirectUrl,
    reference1: payment.id,
  });

  await deps.prisma.payment.update({ where: { id: payment.id }, data: { billplzBillId: bill.id } });
  return { url: bill.url };
}
