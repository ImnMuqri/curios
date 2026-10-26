import type { FastifyBaseLogger, FastifyReply } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  CHIP_DEFAULT_BASE_URL,
  billingDisabled,
  createChipClient,
  evidenceFromPurchase,
  grantPayment,
  notifyRenewalFailure,
  pemFromEnv,
  recordRenewalFailure,
  verifyChipSignature,
  type ChipClient,
  type GrantOutcome,
  type RenewalFailureResult,
} from '@curios/billing';
import { rawJson } from '../../plugins/raw-json.js';
import { UnauthenticatedError } from '../../plugins/session.js';
import { createPurchaseForOwner, errName, resetTrial, turnOffAutoRenew } from './billing.service.js';

export interface BillingRouteOptions {
  /**
   * Injected only by tests, the way the chat routes take a stub model. Without it the
   * client is built from the environment at registration.
   */
  client?: ChipClient;
  /**
   * Told when a renewal charge failed and was counted, so the owner can be mailed. Tests
   * inject it; without it the app mails the owner through its own mail queue.
   */
  onRenewalFailure?: (pageId: string, result: RenewalFailureResult) => Promise<void>;
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
    // A PEM pasted on one line, each newline written as a backslash and an n, reads the
    // same as a multi-line one.
    publicKey: pemFromEnv(process.env.CHIP_PUBLIC_KEY),
    webhookPublicKey: pemFromEnv(
      process.env.NODE_ENV === 'production'
        ? required('CHIP_WEBHOOK_PUBLIC_KEY')
        : process.env.CHIP_WEBHOOK_PUBLIC_KEY,
    ),
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
        { prisma: app.prisma, client: chip.client, callbackBaseUrl: chip.callbackBaseUrl, log: request.log, settings: await app.settings.get() },
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
    '/billing/auto-renew/off',
    { schema: { response: { 200: z.object({ status: z.string() }) } } },
    async (request, reply) => {
      if (!request.account) throw new UnauthenticatedError();
      if (!chip) throw new BillingNotConfiguredError();

      await turnOffAutoRenew(
        { prisma: app.prisma, client: chip.client, log: request.log },
        { accountId: request.account.id },
      );
      request.log.info({ accountId: request.account.id }, 'auto-renew turned off by owner');
      return reply.send({ status: 'off' });
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
  source: 'return' | 'callback' | 'webhook',
  outcome: GrantOutcome,
): void {
  const details = {
    purchaseId,
    source,
    outcome: outcome.kind,
    ...(outcome.kind === 'mismatch' ? { reason: outcome.reason } : {}),
  };
  if (outcome.kind === 'paid-after-failure') {
    // Money taken with no time given: a person has to settle this one.
    log.error(details, 'chip purchase paid after its payment was marked failed or expired');
  } else if (outcome.kind === 'mismatch' || outcome.kind === 'unknown-payment' || outcome.kind === 'test-purchase') {
    log.error(details, 'chip purchase refused');
  } else {
    log.info(details, 'chip purchase handled');
  }
}

/** A purchase nobody will ever pay: the banner says so, rather than "pending". */
const FAILED_PURCHASE_STATUSES = new Set(['expired', 'cancelled', 'error', 'blocked']);

/** CHIP's return, callback and webhook. No session; see app.ts. */
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
      //
      // The lookup is inside the try with the rest: a database error there is as little
      // the owner's doing as a CHIP outage, and "pending" is the honest thing to tell them.
      const paymentId = request.query.payment;
      let purchaseId: string | undefined;
      let autoRenew: boolean;
      let purchaseStatus: string;
      let keptCard: boolean;
      let outcome: GrantOutcome;
      try {
        const payment = paymentId
          ? await app.prisma.payment.findUnique({
              where: { id: paymentId },
              select: { providerRef: true, autoRenew: true },
            })
          : null;
        if (!payment?.providerRef) return back('pending');
        purchaseId = payment.providerRef;
        autoRenew = payment.autoRenew;

        const purchase = await chip.client.getPurchase(payment.providerRef);
        purchaseStatus = purchase.status;
        keptCard = purchase.isRecurringToken;
        outcome = await grantPayment(app.prisma, evidenceFromPurchase(purchase), { now: new Date() });
      } catch (error) {
        // The name only: a refused CHIP call carries CHIP's response body in its message.
        request.log.error({ err: errName(error), purchaseId, source: 'return' }, 'chip purchase could not be confirmed');
        return back('pending');
      }

      logOutcome(request.log, purchaseId, 'return', outcome);
      if (outcome.kind === 'granted' || outcome.kind === 'already-granted') {
        // Auto-renew was asked for and CHIP kept no card: the plan is paid, but it will
        // not renew itself, and the owner should hear that now rather than at expiry. Read
        // from the purchase, not this grant: CHIP's callback usually grants first, and
        // this return then sees already-granted.
        return back('paid', autoRenew && !keptCard);
      }
      return back(FAILED_PURCHASE_STATUSES.has(purchaseStatus) ? 'failed' : 'pending');
    },
  );

  // CHIP signs the exact bytes it posts, so these two read the raw body. The parser that
  // keeps it replaces the JSON one for this scope only.
  await app.register(rawJson);

  // CHIP's public key for the callback: the configured one, else the one CHIP serves,
  // fetched on first use and kept. What is kept is the promise, so concurrent first
  // callbacks share one fetch -- and a failed fetch is forgotten, so the next one retries.
  const chipClient = chip.client;
  let fetchedKey: Promise<string> | undefined;
  const callbackKey = (): Promise<string> => {
    if (chip.publicKey) return Promise.resolve(chip.publicKey);
    fetchedKey ??= chipClient.getPublicKey().catch((error: unknown) => {
      fetchedKey = undefined;
      throw error;
    });
    return fetchedKey;
  };

  const signatureOf = (header: string | string[] | undefined) => (typeof header === 'string' ? header : undefined);
  const bodyId = (body: unknown): string | undefined => {
    const parsed = z.object({ id: z.string().min(1) }).safeParse(body);
    return parsed.success ? parsed.data.id : undefined;
  };

  /**
   * A signed message names a purchase, and nothing else in it is believed: the purchase is
   * fetched from CHIP by that id, and the grant is made from what CHIP says.
   */
  async function grantFromChip(log: FastifyBaseLogger, purchaseId: string, source: 'callback' | 'webhook') {
    const purchase = await chipClient.getPurchase(purchaseId);
    const outcome = await grantPayment(app.prisma, evidenceFromPurchase(purchase), { now: new Date() });
    logOutcome(log, purchaseId, source, outcome);
    return { status: outcome.kind };
  }

  const badSignature = (reply: FastifyReply) =>
    reply.status(400).send({ error: { code: 'BAD_SIGNATURE', message: 'Signature does not verify.' } });

  // A signature that does not verify is a 400, never a 200 that would tell CHIP to stop
  // sending. A failure of ours -- the database, CHIP, the key fetch -- is left to surface
  // as a 500, so CHIP sends the message again.
  app.post('/billing/chip/callback', async (request, reply) => {
    // No signature at all is refused before the key is fetched: an unsigned flood must
    // not turn into calls to CHIP.
    const signature = signatureOf(request.headers['x-signature']);
    if (!signature) {
      request.log.warn({ source: 'callback' }, 'chip message refused: no signature');
      return badSignature(reply);
    }
    const publicKey = await callbackKey();
    if (!verifyChipSignature(request.rawBody ?? '', signature, publicKey)) {
      request.log.warn({ source: 'callback' }, 'chip message refused: bad signature');
      return badSignature(reply);
    }
    const purchaseId = bodyId(request.body);
    if (!purchaseId) return reply.send({ status: 'ignored' });
    return reply.send(await grantFromChip(request.log, purchaseId, 'callback'));
  });

  // The owner hears about a counted renewal failure. notifyRenewalFailure never throws, so
  // a mail queue that is down cannot turn a recorded failure into a 500 and a resend.
  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
  const onRenewalFailure =
    options.onRenewalFailure ??
    ((pageId: string, result: RenewalFailureResult) =>
      notifyRenewalFailure({ prisma: app.prisma, mailQueue: app.mailQueue, appUrl, log: app.log }, pageId, result));

  const webhookPublicKey = chip.webhookPublicKey;
  if (!webhookPublicKey) {
    app.log.warn(
      'No CHIP_WEBHOOK_PUBLIC_KEY: the CHIP webhook is off in development, so a failed renewal ' +
        'charge is not counted. Production refuses to start without it.',
    );
    return;
  }

  // The webhook has a key of its own and only that key passes here: a callback signature
  // is not a webhook signature.
  app.post('/billing/chip/webhook', async (request, reply) => {
    const signature = signatureOf(request.headers['x-signature']);
    if (!signature) {
      request.log.warn({ source: 'webhook' }, 'chip message refused: no signature');
      return badSignature(reply);
    }
    if (!verifyChipSignature(request.rawBody ?? '', signature, webhookPublicKey)) {
      request.log.warn({ source: 'webhook' }, 'chip message refused: bad signature');
      return badSignature(reply);
    }
    const purchaseId = bodyId(request.body);
    if (!purchaseId) return reply.send({ status: 'ignored' });
    const event = (request.body as { event_type?: unknown }).event_type;

    if (event === 'purchase.paid') return reply.send(await grantFromChip(request.log, purchaseId, 'webhook'));

    if (event === 'purchase.payment_failure') {
      const payment = await app.prisma.payment.findFirst({
        where: { provider: 'CHIP', providerRef: purchaseId },
        select: { id: true, pageId: true, autoRenewal: true },
      });
      // A failed first payment is the owner's to retry at checkout; only a renewal charge
      // is ours to count.
      if (!payment?.autoRenewal || !payment.pageId) return reply.send({ status: 'ignored' });
      const result = await recordRenewalFailure(app.prisma, payment.id, new Date());
      request.log.info({ purchaseId, source: 'webhook', outcome: `renewal-${result.kind}` }, 'chip purchase handled');
      await onRenewalFailure(payment.pageId, result);
      return reply.send({ status: `renewal-${result.kind}` });
    }
    return reply.send({ status: 'ignored' });
  });
};
