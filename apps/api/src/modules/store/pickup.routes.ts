import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { UnauthenticatedError } from '../../plugins/session.js';
import {
  addPickupPlace,
  listPickupPlaces,
  removePickupPlace,
  reorderPickupPlaces,
  updatePickupPlace,
} from './pickup.service.js';

const params = z.object({ id: z.string().min(1).max(64) });

// Payload bounds only; the service owns every rule with a sentence.
const placeInput = z.object({
  name: z.string().max(200),
  address: z.string().max(1000),
  mapUrl: z.string().max(2000).nullable(),
  note: z.string().max(1000).nullable(),
  anyTime: z.boolean(),
  windows: z
    .array(
      z.object({
        id: z.string().min(1).max(64).optional(),
        from: z.number().int(),
        to: z.number().int(),
        limit: z.number().int().nullable(),
      }),
    )
    .max(100),
});

/** The owner's pickup places. Every answer is the shop's whole list, so the client never merges. */
export const pickupRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/store/pickup-places', async (request) => {
    if (!request.account) throw new UnauthenticatedError();
    return { places: await listPickupPlaces(app.prisma, request.account.id) };
  });

  app.post('/store/pickup-places', { schema: { body: placeInput } }, async (request, reply) => {
    if (!request.account) throw new UnauthenticatedError();
    return reply.status(201).send({ places: await addPickupPlace(app.prisma, request.account.id, request.body) });
  });

  app.post(
    '/store/pickup-places/order',
    { schema: { body: z.object({ ids: z.array(z.string().min(1).max(64)).max(50) }) } },
    async (request) => {
      if (!request.account) throw new UnauthenticatedError();
      return { places: await reorderPickupPlaces(app.prisma, request.account.id, request.body.ids) };
    },
  );

  app.put('/store/pickup-places/:id', { schema: { params, body: placeInput } }, async (request) => {
    if (!request.account) throw new UnauthenticatedError();
    return { places: await updatePickupPlace(app.prisma, request.account.id, request.params.id, request.body) };
  });

  app.delete('/store/pickup-places/:id', { schema: { params } }, async (request) => {
    if (!request.account) throw new UnauthenticatedError();
    return { places: await removePickupPlace(app.prisma, request.account.id, request.params.id) };
  });
};
