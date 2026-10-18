import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ADDRESS_MAX, NAME_MAX, ORDER_NOTE_MAX } from '@curios/core/orders';
import { PricesChangedError } from './order.errors.js';
import { placeOrder, type OrderMailQueue } from './place.service.js';

export interface OrderRouteOptions {
  /** Injected only by tests; production queues on the app's mail queue. */
  mailQueue?: OrderMailQueue;
}

const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

const shelfItem = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  photoKey: z.string().nullable(),
  priceCents: z.number().nullable(),
  options: z.array(z.object({ id: z.string(), label: z.string(), priceCents: z.number() })),
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
              }),
            )
            .min(1)
            .max(50),
          method: z.enum(['PICKUP', 'DELIVERY']),
          // Its shape and whether the shop takes that day are isOrderDay's to
          // say, so a bad one gets the same ORDER_DATE sentence either way.
          day: z.string().max(10),
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
          409: errorSchema.extend({ items: z.array(shelfItem).optional() }),
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
        // { code, message }: the basket reloads from `items`.
        if (error instanceof PricesChangedError) {
          return reply.status(409).send({ error: { code: error.code, message: error.message }, items: error.items });
        }
        throw error;
      }
    },
  );
};
