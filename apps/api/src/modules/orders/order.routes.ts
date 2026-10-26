import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { resolveApiUrl } from '@curios/core/digital';
import { ADDRESS_MAX, NAME_MAX, ORDER_NOTE_MAX } from '@curios/core/orders';
import { PricesChangedError } from './order.errors.js';
import { placeOrder, type OrderMailQueue } from './place.service.js';
import { resolveStore, type AvatarStore } from '../pages/storage.js';
import { UnauthenticatedError } from '../../plugins/session.js';
import { moveTime, newCode, newLinks, resendDelivery, type DeliveryMailDeps } from './deliver.service.js';
import { cancelOrder, markCompleted, markNotReceived, markPaid, markRefunded } from './owner.service.js';
import { uploadReceipt } from './receipt.service.js';
import { cancelChipBeforeOwnerMove } from './pay-online.service.js';
import type { PayOnline } from './pay-online.routes.js';

export interface OrderRouteOptions {
  /** Injected only by tests; production queues on the app's mail queue. */
  mailQueue?: OrderMailQueue;
  /** As StoreRouteOptions.store: undefined builds from the environment, null is uploads off, tests pass a stub. */
  store?: AvatarStore | null;
  /** How often the order page's check may ask CHIP about one order; tests pass 0. */
  payStatusEveryMs?: number;
  /** Paying online, for the owner's cancel and mark paid: each cancels CHIP's purchase first. Set by app.ts. */
  payOnline?: PayOnline;
  /** PAYMENT_SECRETS_KEY, set by app.ts: placing seals the order token with it. */
  secretsKey?: Buffer | null;
}

const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

const shelfItem = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  photoKey: z.string().nullable(),
  priceCents: z.number().nullable(),
  options: z.array(z.object({ id: z.string(), label: z.string(), priceCents: z.number() })),
  kind: z.enum(['PHYSICAL', 'DIGITAL']),
  delivery: z.enum(['FILES', 'LINK', 'CODES', 'SESSION']).nullable(),
  format: z.object({ kinds: z.array(z.string()), count: z.number() }).nullable(),
  soldOut: z.boolean(),
  sessions: z.array(z.object({ id: z.string(), startsAt: z.string(), seatsLeft: z.number() })),
  minutes: z.number().nullable(),
  place: z.enum(['ONLINE', 'IN_PERSON']).nullable(),
});

/** The visitor's checkout. Anonymous and rate-limited (app.ts), like POST /leads. */
export const orderRoutes: FastifyPluginAsyncZod<OrderRouteOptions> = async (app, options) => {
  app.post(
    '/store/:handle/orders',
    {
      schema: {
        params: z.object({ handle: z.string().min(1).max(64) }),
        body: z.object({
          lines: z
            .array(
              z.object({
                itemId: z.string().min(1).max(64),
                optionId: z.string().min(1).max(64).nullable(),
                quantity: z.number().int().min(1).max(99),
                // The class time, on a SESSION item's line only.
                sessionId: z.string().min(1).max(64).nullable().optional(),
              }),
            )
            .min(1)
            .max(50),
          // Both absent for a digital-only basket, both present as soon as it holds a
          // physical item: the basket decides, so placeOrder checks it (INVALID_ORDER).
          method: z.enum(['PICKUP', 'DELIVERY']).nullable().optional(),
          // Its shape and whether the shop takes that day are isOrderDay's to
          // say, so a bad one gets the same ORDER_DATE sentence either way.
          day: z.string().max(10).nullable().optional(),
          // Where digital items go; placeOrder requires it (EMAIL_REQUIRED) when any line is digital.
          email: z.string().max(254).nullable().optional(),
          customerName: z.string().trim().min(1).max(NAME_MAX),
          phone: z.string().min(1).max(24),
          address: z.string().max(ADDRESS_MAX).nullable(),
          note: z.string().max(ORDER_NOTE_MAX).nullable(),
          // Present and true, as on the lead card: PDPA consent is something
          // the visitor did, not a default assumed for them.
          consent: z.literal(true),
          seenTotalCents: z.number().int().min(0),
        }),
        response: {
          201: z.object({ number: z.number(), code: z.string(), token: z.string(), totalCents: z.number() }),
          400: errorSchema,
          403: errorSchema,
          404: errorSchema,
          409: errorSchema.extend({
            items: z.array(shelfItem).optional(),
            delivery: z.object({ mode: z.enum(['NONE', 'FLAT', 'RIDER']), feeCents: z.number().nullable() }).optional(),
          }),
          410: errorSchema,
        },
      },
    },
    async (request, reply) => {
      const { consent: _consent, ...body } = request.body;
      try {
        const placed = await placeOrder(
          {
            prisma: app.prisma,
            mailQueue: options.mailQueue ?? app.mailQueue,
            log: request.log,
            appUrl: process.env.APP_URL ?? 'http://localhost:3000',
            secretsKey: options.secretsKey ?? null,
          },
          { handle: request.params.handle, ...body },
          new Date(),
        );
        // The number and nothing else: the token is the order's whole key,
        // and a name or phone number has no business in the log.
        request.log.info({ handle: request.params.handle, number: placed.number }, 'order placed');
        return reply.status(201).send(placed);
      } catch (error) {
        // Sent here rather than by the errors plugin, which only ever sends
        // { code, message }: checkout reloads from `items` and `delivery`.
        if (error instanceof PricesChangedError) {
          return reply
            .status(409)
            .send({ error: { code: error.code, message: error.message }, items: error.items, delivery: error.delivery });
        }
        throw error;
      }
    },
  );
};

/**
 * The customer's receipt, on their order link. Its own plugin because it has
 * its own limiter (app.ts): the per-shop one keys on a `handle` this path lacks.
 */
export const receiptRoutes: FastifyPluginAsyncZod<OrderRouteOptions> = async (app, options) => {
  const store = resolveStore(options.store);

  app.post(
    '/store/orders/:token/receipt',
    {
      // 5 MB of file is about 7 MB of base64.
      bodyLimit: 7 * 1024 * 1024,
      schema: {
        params: z.object({ token: z.string().min(1).max(128) }),
        body: z.object({ contentType: z.string().max(40), data: z.string().max(7_000_000) }),
        response: { 200: z.object({ receiptUploadedAt: z.string() }), 400: errorSchema, 403: errorSchema, 404: errorSchema, 409: errorSchema, 410: errorSchema, 503: errorSchema },
      },
    },
    async (request) => {
      const { receiptUploadedAt } = await uploadReceipt(
        {
          prisma: app.prisma,
          mailQueue: options.mailQueue ?? app.mailQueue,
          store,
          log: request.log,
          appUrl: process.env.APP_URL ?? 'http://localhost:3000',
        },
        request.params.token,
        request.body,
        new Date(),
      );
      // Never the token: it is the order's whole key.
      request.log.info('receipt uploaded');
      return { receiptUploadedAt: receiptUploadedAt.toISOString() };
    },
  );
};

/** The signed-in owner's moves on their orders (app.ts, in the requireSession scope). */
export const ownerOrderRoutes: FastifyPluginAsyncZod<OrderRouteOptions> = async (app, options) => {
  const store = resolveStore(options.store);

  const moves = {
    paid: markPaid,
    'not-received': markNotReceived,
    completed: markCompleted,
    cancel: cancelOrder,
    refunded: markRefunded,
  } as const;

  // Resolved once at registration (throws in production when unset), not per request.
  const apiUrl = options.payOnline?.apiUrl ?? resolveApiUrl(process.env);

  /** The buyer's delivery email, for the owner's paid mark and "send again". */
  const mailDeps = (log: DeliveryMailDeps['log']): DeliveryMailDeps => ({
    prisma: app.prisma,
    mailQueue: options.mailQueue ?? app.mailQueue,
    secretsKey: options.payOnline?.secretsKey ?? null,
    appUrl: process.env.APP_URL ?? 'http://localhost:3000',
    apiUrl,
    log,
  });

  for (const [action, run] of Object.entries(moves)) {
    app.post(
      `/orders/:id/${action}`,
      {
        schema: {
          params: z.object({ id: z.string().min(1).max(64) }),
          response: { 204: z.null(), 404: errorSchema, 409: errorSchema },
        },
      },
      async (request, reply) => {
        if (!request.account) throw new UnauthenticatedError();
        const now = new Date();
        if ((action === 'cancel' || action === 'paid') && options.payOnline) {
          await cancelChipBeforeOwnerMove({ ...options.payOnline, log: request.log }, request.account.id, request.params.id, now);
        }
        await run({ prisma: app.prisma, store, log: request.log, mail: mailDeps(request.log) }, request.account.id, request.params.id, now);
        // The id and the move: no customer detail belongs in the log.
        request.log.info({ orderId: request.params.id, action }, 'order moved');
        return reply.status(204).send(null);
      },
    );
  }

  // Digital orders: each acts on a paid, delivered order the owner owns (404 otherwise, 409 ORDER_STATE if not delivered).
  const idParams = z.object({ id: z.string().min(1).max(64) });
  const lineBody = z.object({ lineId: z.string().min(1).max(64) });
  const ownerResponse = { 204: z.null(), 404: errorSchema, 409: errorSchema };

  app.post('/orders/:id/resend', { schema: { params: idParams, response: ownerResponse } }, async (request, reply) => {
    if (!request.account) throw new UnauthenticatedError();
    await resendDelivery(mailDeps(request.log), request.account.id, request.params.id);
    request.log.info({ orderId: request.params.id, action: 'resend' }, 'order moved');
    return reply.status(204).send(null);
  });

  app.post('/orders/:id/new-links', { schema: { params: idParams, response: ownerResponse } }, async (request, reply) => {
    if (!request.account) throw new UnauthenticatedError();
    await newLinks({ prisma: app.prisma }, request.account.id, request.params.id, new Date());
    request.log.info({ orderId: request.params.id, action: 'new-links' }, 'order moved');
    return reply.status(204).send(null);
  });

  app.post('/orders/:id/new-code', { schema: { params: idParams, body: lineBody, response: ownerResponse } }, async (request, reply) => {
    if (!request.account) throw new UnauthenticatedError();
    await newCode({ prisma: app.prisma }, request.account.id, request.params.id, request.body.lineId, new Date());
    request.log.info({ orderId: request.params.id, action: 'new-code' }, 'order moved');
    return reply.status(204).send(null);
  });

  app.post(
    '/orders/:id/move-time',
    { schema: { params: idParams, body: lineBody.extend({ sessionId: z.string().min(1).max(64) }), response: ownerResponse } },
    async (request, reply) => {
      if (!request.account) throw new UnauthenticatedError();
      await moveTime({ prisma: app.prisma }, request.account.id, request.params.id, request.body.lineId, request.body.sessionId, new Date());
      request.log.info({ orderId: request.params.id, action: 'move-time' }, 'order moved');
      return reply.status(204).send(null);
    },
  );
};
