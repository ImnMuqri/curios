import type { FastifyBaseLogger } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createBillplzClient,
  evidenceFromBill,
  evidenceFromCallback,
  flattenRedirectParams,
  grantPayment,
  verifyBillplzSignature,
  type BillplzClient,
  type GrantOutcome,
} from '@curios/billing';
import { UnauthenticatedError } from '../../plugins/session.js';
import { createBillForOwner } from './billing.service.js';

export interface BillingRouteOptions {
  /**
   * Injected only by tests, the way the chat routes take a stub model. Without it the
   * client is built from the environment at registration.
   */
  client?: BillplzClient;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/**
 * Every Billplz setting, read once at registration -- the moment the chat routes check
 * their model key, and for the same reason: a missing value fails the deploy, not an
 * owner's payment. A missing signature key in particular must never reach a request,
 * where it could only mean refusing every genuine payment.
 */
function billplzSettings(options: BillingRouteOptions) {
  const apiKey = required('BILLPLZ_API_KEY');
  const baseUrl = required('BILLPLZ_BASE_URL');
  return {
    client: options.client ?? createBillplzClient({ apiKey, baseUrl }),
    collectionId: required('BILLPLZ_COLLECTION_ID'),
    signatureKey: required('BILLPLZ_X_SIGNATURE_KEY'),
    callbackUrl: required('BILLPLZ_CALLBACK_URL'),
    redirectUrl: required('BILLPLZ_REDIRECT_URL'),
  };
}

const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

/** Starting a payment. Registered behind a session and a per-account limit in app.ts. */
export const ownerBillingRoutes: FastifyPluginAsyncZod<BillingRouteOptions> = async (app, options) => {
  const billplz = billplzSettings(options);

  app.post(
    '/billing/bills',
    {
      schema: {
        body: z.object({ plan: z.enum(['MONTHLY', 'ANNUAL']) }),
        response: { 201: z.object({ url: z.string() }), 400: errorSchema, 404: errorSchema },
      },
    },
    async (request, reply) => {
      if (!request.account) throw new UnauthenticatedError();

      const result = await createBillForOwner(
        { prisma: app.prisma, client: billplz.client, config: billplz },
        { accountId: request.account.id, plan: request.body.plan },
      );
      return reply.status(201).send(result);
    },
  );
};

/**
 * The bill id and the outcome, and nothing else. Billplz's parameters carry the payer's
 * email and mobile, and logging them on the way past is how they end up somewhere they
 * were never meant to be.
 */
function logOutcome(
  log: FastifyBaseLogger,
  billId: string | undefined,
  source: 'callback' | 'redirect',
  outcome: GrantOutcome,
): void {
  const details = {
    billId,
    source,
    outcome: outcome.kind,
    ...(outcome.kind === 'mismatch' ? { reason: outcome.reason } : {}),
  };
  if (outcome.kind === 'mismatch' || outcome.kind === 'unknown-bill') {
    log.error(details, 'billplz bill refused');
  } else {
    log.info(details, 'billplz bill handled');
  }
}

/** Billplz's callback and redirect. No session, and no per-IP limit -- see app.ts. */
export const billplzRoutes: FastifyPluginAsyncZod<BillingRouteOptions> = async (app, options) => {
  const billplz = billplzSettings(options);

  // Billplz posts its callback form-encoded, and nothing else in this API accepts a
  // form. Added inside this plugin's own encapsulated scope, so no other route starts
  // to. URLSearchParams keeps every value exactly as sent, which is what the signature
  // was computed over.
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_request, body, done) => {
      done(null, Object.fromEntries(new URLSearchParams(String(body))));
    },
  );

  app.post(
    '/billing/billplz/callback',
    { schema: { body: z.record(z.string(), z.string()) } },
    async (request, reply) => {
      if (!verifyBillplzSignature(request.body, billplz.signatureKey)) {
        request.log.error({ billId: request.body.id, source: 'callback' }, 'billplz signature did not verify');
        return reply.status(400).send();
      }

      const outcome = await grantPayment(app.prisma, evidenceFromCallback(request.body), { now: new Date() });
      logOutcome(request.log, request.body.id, 'callback', outcome);
      // 200 for everything that verified. Billplz retries anything else, and no retry
      // can fix an unpaid bill or one that does not match what we billed.
      return reply.status(200).send({ status: outcome.kind });
    },
  );

  app.get(
    '/billing/billplz/return',
    { schema: { querystring: z.record(z.string(), z.string()) } },
    async (request, reply) => {
      const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
      const back = (payment: 'paid' | 'pending' | 'failed') =>
        reply.redirect(`${appUrl}/app/billing?payment=${payment}`);
      const billId = request.query['billplz[id]'];

      if (!verifyBillplzSignature(flattenRedirectParams(request.query), billplz.signatureKey)) {
        request.log.error({ billId, source: 'redirect' }, 'billplz signature did not verify');
        return back('pending');
      }
      if (request.query['billplz[paid]'] !== 'true') return back('failed');

      // The redirect carries no amount, collection or reference, so it cannot be bound
      // as it stands. One fetch of the bill supplies them -- the same call the hourly
      // check makes, once per payment, which is not polling.
      let outcome: GrantOutcome;
      try {
        const bill = await billplz.client.getBill(billId ?? '');
        outcome = await grantPayment(app.prisma, evidenceFromBill(bill), { now: new Date() });
      } catch (error) {
        request.log.error({ err: error, billId, source: 'redirect' }, 'billplz bill could not be confirmed');
        return back('pending');
      }

      logOutcome(request.log, billId, 'redirect', outcome);
      return back(outcome.kind === 'granted' || outcome.kind === 'already-granted' ? 'paid' : 'pending');
    },
  );
};
