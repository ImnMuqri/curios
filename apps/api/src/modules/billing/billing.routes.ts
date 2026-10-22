import type { FastifyBaseLogger } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  CHIP_DEFAULT_BASE_URL,
  billingDisabled,
  createChipClient,
  evidenceFromPurchase,
  grantPayment,
  type ChipClient,
  type GrantOutcome,
} from '@curios/billing';
import { UnauthenticatedError } from '../../plugins/session.js';
import { createPurchaseForOwner, resetTrial } from './billing.service.js';

export interface BillingRouteOptions {
  /**
   * Injected only by tests, the way the chat routes take a stub model. Without it the
   * client is built from the environment at registration.
   */
  client?: ChipClient;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/**
 * Billing is switched off in this environment -- development with no CHIP settings,
 * see `billingDisabled`. A 503 like CHIP_UNAVAILABLE, so the web app turns the code
 * into its own sentence; it can never happen in production, where the settings are
 * required at startup.
 */
export class BillingNotConfiguredError extends Error {
  readonly statusCode = 503;
  readonly code = 'BILLING_NOT_CONFIGURED';
  constructor() {
    super('Billing is not configured in this environment.');
    this.name = 'BillingNotConfiguredError';
  }
}

/**
 * Every CHIP setting, read once at registration -- the moment the chat routes check
 * their model key, and for the same reason: a missing value fails the deploy, not an
 * owner's payment. A missing webhook key in particular must never reach a request,
 * where it could only mean refusing every genuine payment -- so in production it is
 * required here, and optional only where a developer has no webhook registered.
 *
 * Null only when billing is switched off: outside production, with none of the required
 * settings present. A test that injects a client is never switched off.
 */
export function chipSettings(options: BillingRouteOptions) {
  if (!options.client && billingDisabled()) return null;
  const secretKey = required('CHIP_SECRET_KEY');
  const brandId = required('CHIP_BRAND_ID');
  const callbackBaseUrl = required('CHIP_CALLBACK_BASE_URL').replace(/\/+$/, '');
  const baseUrl = process.env.CHIP_BASE_URL || CHIP_DEFAULT_BASE_URL;
  return {
    client: options.client ?? createChipClient({ secretKey, brandId, baseUrl }),
    callbackBaseUrl,
    publicKey: process.env.CHIP_PUBLIC_KEY || undefined,
    webhookPublicKey:
      process.env.NODE_ENV === 'production'
        ? required('CHIP_WEBHOOK_PUBLIC_KEY')
        : process.env.CHIP_WEBHOOK_PUBLIC_KEY || undefined,
  };
}

const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

/** Starting a payment. Registered behind a session and a per-account limit in app.ts. */
export const ownerBillingRoutes: FastifyPluginAsyncZod<BillingRouteOptions> = async (app, options) => {
  const chip = chipSettings(options);
  if (!chip) {
    app.log.warn(
      'No CHIP_* settings: billing is switched off in development. Starting a payment ' +
        'answers BILLING_NOT_CONFIGURED. Production refuses to start without them.',
    );
  }

  app.post(
    '/billing/purchases',
    {
      schema: {
        body: z.object({ plan: z.enum(['MONTHLY', 'ANNUAL']), autoRenew: z.boolean().default(false) }),
        response: { 201: z.object({ url: z.string() }), 400: errorSchema, 404: errorSchema },
      },
    },
    async (request, reply) => {
      if (!request.account) throw new UnauthenticatedError();
      if (!chip) throw new BillingNotConfiguredError();

      const result = await createPurchaseForOwner(
        { prisma: app.prisma, client: chip.client, callbackBaseUrl: chip.callbackBaseUrl, log: request.log },
        {
          accountId: request.account.id,
          plan: request.body.plan,
          autoRenew: request.body.autoRenew,
          now: new Date(),
        },
      );
      return reply.status(201).send(result);
    },
  );

  app.post(
    '/billing/trial-reset',
    { schema: { response: { 200: z.object({ status: z.string() }), 409: errorSchema } } },
    async (request, reply) => {
      if (!request.account) throw new UnauthenticatedError();

      await resetTrial({ prisma: app.prisma }, { accountId: request.account.id, now: new Date() });
      // The account and the outcome. Which page it was is derivable from the
      // account, and a reset is worth being able to find in the log: it is the
      // one place the product gives something away.
      request.log.info({ accountId: request.account.id }, 'free trial reset by owner');
      return reply.send({ status: 'reset' });
    },
  );
};

/**
 * The purchase id and the outcome, and nothing else. A purchase carries the payer's
 * email and name, and logging them on the way past is how they end up somewhere they
 * were never meant to be.
 */
function logOutcome(
  log: FastifyBaseLogger,
  purchaseId: string | undefined,
  source: 'return',
  outcome: GrantOutcome,
): void {
  const details = {
    purchaseId,
    source,
    outcome: outcome.kind,
    ...(outcome.kind === 'mismatch' ? { reason: outcome.reason } : {}),
  };
  if (outcome.kind === 'mismatch' || outcome.kind === 'unknown-payment') {
    log.error(details, 'chip purchase refused');
  } else {
    log.info(details, 'chip purchase handled');
  }
}

/** A purchase nobody will ever pay: the banner says so, rather than "pending". */
const FAILED_PURCHASE_STATUSES = new Set(['expired', 'cancelled', 'error', 'blocked']);

/** CHIP's return, and -- with Task 5 -- its callback and webhook. No session; see app.ts. */
export const chipRoutes: FastifyPluginAsyncZod<BillingRouteOptions> = async (app, options) => {
  const chip = chipSettings(options);
  // Switched off: no purchase can have been started, so CHIP has nothing to send anyone
  // back from, and a route that could only refuse is better not registered at all.
  if (!chip) return;

  app.get(
    '/billing/chip/return',
    { schema: { querystring: z.object({ payment: z.string().optional() }) } },
    async (request, reply) => {
      const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
      const back = (payment: 'paid' | 'pending' | 'failed', cardOff = false) =>
        reply.redirect(`${appUrl}/app/billing?payment=${payment}${cardOff ? '&card=off' : ''}`);

      // The redirect is unsigned: it carries only our own payment id, so nothing in it is
      // trusted. The purchase is fetched from CHIP by the id we stored, and that -- not
      // the query -- decides what is granted. A forged id can only make us ask CHIP
      // about a purchase of ours.
      const paymentId = request.query.payment;
      const payment = paymentId
        ? await app.prisma.payment.findUnique({
            where: { id: paymentId },
            select: { providerRef: true, autoRenew: true },
          })
        : null;
      if (!payment?.providerRef) return back('pending');

      let outcome: GrantOutcome;
      let purchaseStatus: string;
      try {
        const purchase = await chip.client.getPurchase(payment.providerRef);
        purchaseStatus = purchase.status;
        outcome = await grantPayment(app.prisma, evidenceFromPurchase(purchase), { now: new Date() });
      } catch (error) {
        request.log.error(
          { err: error, purchaseId: payment.providerRef, source: 'return' },
          'chip purchase could not be confirmed',
        );
        return back('pending');
      }

      logOutcome(request.log, payment.providerRef, 'return', outcome);
      if (outcome.kind === 'granted' || outcome.kind === 'already-granted') {
        // Auto-renew was asked for and CHIP kept no card: the plan is paid, but it will
        // not renew itself, and the owner should hear that now rather than at expiry.
        return back('paid', outcome.kind === 'granted' && payment.autoRenew && !outcome.cardSaved);
      }
      return back(FAILED_PURCHASE_STATUSES.has(purchaseStatus) ? 'failed' : 'pending');
    },
  );
};
