import type { FastifyReply } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { CHIP_DEFAULT_BASE_URL, createChipClient, verifyChipSignature } from '@curios/billing';
import { ORDER_TOTAL_MAX_CENTS } from '@curios/core/orders';
import { rawJson } from '../../plugins/raw-json.js';
import { errName } from '../billing/billing.service.js';
import { resolveStore, type AvatarStore } from '../pages/storage.js';
import { resolveSecretsKey, type ShopChipRouteOptions } from '../store/chip.routes.js';
import type { ChipClientFor } from '../store/chip.service.js';
import {
  MethodsCache,
  openOwnerClient,
  orderForCallback,
  payMethodsFor,
  payStatus,
  settleChipPurchase,
  startOnlinePayment,
  type PayOnlineDeps,
} from './pay-online.service.js';

export interface PayOnlineRouteOptions {
  chip?: ShopChipRouteOptions;
  /** As OrderRouteOptions.store: where a receipt sent before paying online is removed from. */
  store?: AvatarStore | null;
}

const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

/** Everything paying online needs, read once at registration. */
function payOnlineSettings(options: PayOnlineRouteOptions) {
  const chip = options.chip ?? {};
  const production = chip.production ?? process.env.NODE_ENV === 'production';
  const baseUrl = process.env.CHIP_BASE_URL || CHIP_DEFAULT_BASE_URL;
  const callbackBaseUrl =
    chip.callbackBaseUrl !== undefined ? chip.callbackBaseUrl : process.env.CHIP_CALLBACK_BASE_URL?.trim() || null;
  return {
    production,
    secretsKey: resolveSecretsKey(chip, production),
    clientFor: chip.clientFor ?? ((({ secretKey, brandId }) => createChipClient({ secretKey, brandId, baseUrl })) satisfies ChipClientFor),
    callbackBaseUrl: callbackBaseUrl ? callbackBaseUrl.replace(/\/+$/, '') : null,
    appUrl: (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/+$/, ''),
    store: resolveStore(options.store),
  };
}

/**
 * Checkout's online payment and the order page's check, on the customer's order
 * link. Anonymous, as the receipt is, and under its own per-IP budget (app.ts).
 */
export const shopPayRoutes: FastifyPluginAsyncZod<PayOnlineRouteOptions> = async (app, options) => {
  const settings = payOnlineSettings(options);
  const methods = new MethodsCache();
  const deps = (log: PayOnlineDeps['log']): PayOnlineDeps => ({ prisma: app.prisma, methods, log, ...settings });

  app.get(
    '/store/:handle/pay-methods',
    {
      schema: {
        params: z.object({ handle: z.string().min(1).max(64) }),
        querystring: z.object({ amount: z.coerce.number().int().min(1).max(ORDER_TOTAL_MAX_CENTS) }),
        response: {
          200: z.object({ fpx: z.boolean(), wallets: z.array(z.enum(['tng', 'grab', 'spay'])), card: z.boolean() }),
          400: errorSchema,
        },
      },
    },
    async (request) => payMethodsFor(deps(request.log), request.params.handle, request.query.amount, new Date()),
  );

  app.post(
    '/store/orders/:token/pay',
    {
      schema: {
        params: z.object({ token: z.string().min(1).max(128) }),
        body: z.object({
          method: z.enum(['fpx', 'tng', 'grab', 'spay', 'card']),
          bank: z.string().max(20).optional(),
          // CHIP needs an email for its receipt (owner's answer 2: asked only for an online method).
          email: z.string().trim().min(3).max(254).email(),
        }),
        response: { 200: z.object({ url: z.string().nullable() }), 400: errorSchema, 404: errorSchema, 409: errorSchema },
      },
    },
    async (request) => {
      const { method, bank, email } = request.body;
      return startOnlinePayment(deps(request.log), request.params.token, { method, ...(bank ? { bank } : {}), email }, new Date());
    },
  );

  app.get(
    '/store/orders/:token/pay-status',
    {
      schema: {
        params: z.object({ token: z.string().min(1).max(128) }),
        response: {
          200: z.union([
            z.object({ state: z.literal('paid'), paidAt: z.string().nullable(), paidMethodLabel: z.string().nullable(), paidRef: z.string().nullable() }),
            z.object({ state: z.enum(['pending', 'failed', 'none']) }),
          ]),
          404: errorSchema,
        },
      },
    },
    async (request) => payStatus(deps(request.log), request.params.token, new Date()),
  );
};

/**
 * CHIP's callback for a shop's order, verified with THAT shop's own public key and
 * settled with what CHIP says when asked with that shop's own key. No session and
 * no limit, as billing's callback (app.ts): a forged one costs a lookup and a
 * signature check to refuse. The raw body is kept, because the signature is over it.
 */
export const shopChipCallbackRoutes: FastifyPluginAsyncZod<PayOnlineRouteOptions> = async (app, options) => {
  const settings = payOnlineSettings(options);
  const methods = new MethodsCache();
  await app.register(rawJson);

  const badSignature = (reply: FastifyReply) =>
    reply.status(400).send({ error: { code: 'BAD_SIGNATURE', message: 'Signature does not verify.' } });

  // 200 for every outcome that is settled (CHIP stops sending), 400 for a bad
  // signature, and a failure of ours (the database, CHIP, the key) left to surface
  // as a 500 so CHIP sends it again.
  app.post('/store/chip/callback/:orderId', { schema: { params: z.object({ orderId: z.string().min(1).max(64) }) } }, async (request, reply) => {
    const signature = typeof request.headers['x-signature'] === 'string' ? request.headers['x-signature'] : undefined;
    // Refused before anything is read: an unsigned flood costs nothing.
    if (!signature) {
      request.log.warn({ source: 'shop-callback' }, 'chip message refused: no signature');
      return badSignature(reply);
    }
    const order = await orderForCallback(app.prisma, request.params.orderId);
    const account = order?.page.paymentAccount;
    if (!order || !account) return reply.send({ status: 'ignored' });
    if (!verifyChipSignature(request.rawBody ?? '', signature, account.publicKeyPem)) {
      request.log.warn({ source: 'shop-callback', orderId: order.id }, 'chip message refused: bad signature');
      return badSignature(reply);
    }
    // The id is the only thing the body is believed for, and only this order's own purchase is looked up.
    const parsed = z.object({ id: z.string().min(1) }).safeParse(request.body);
    if (!parsed.success || parsed.data.id !== order.chipPurchaseId) return reply.send({ status: 'ignored' });

    const deps: PayOnlineDeps = { prisma: app.prisma, methods, log: request.log, ...settings };
    const now = new Date();
    const client = await openOwnerClient(deps, account, now);
    if (!client) throw new Error('The shop’s CHIP key cannot be opened');
    let outcome;
    try {
      outcome = await settleChipPurchase(deps, order, await client.getPurchase(parsed.data.id), now);
    } catch (error) {
      // The name only: a refused CHIP call carries CHIP's response body in its message.
      request.log.error({ orderId: order.id, err: errName(error), source: 'shop-callback' }, 'order purchase could not be confirmed');
      throw new Error(`A call to CHIP failed: ${errName(error)}`);
    }
    request.log.info({ orderId: order.id, purchaseId: parsed.data.id, outcome, source: 'shop-callback' }, 'order purchase handled');
    return reply.send({ status: outcome });
  });
};
