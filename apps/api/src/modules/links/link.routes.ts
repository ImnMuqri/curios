import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { TILE_SIZES } from '@curios/core/bento';
import { UnauthenticatedError } from '../../plugins/session.js';
import { addLink, listLinks, removeLink, reorderLinks, updateLink } from './link.service.js';

// Payload bounds only. Every rule an owner can break is checked in the service,
// where it has a code and a sentence; a zod failure reaches them as INTERNAL_ERROR.
const params = z.object({ id: z.string().min(1).max(64) });
const label = z.string().max(400);
const url = z.string().max(2000);

export const linkRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/links', async (request) => {
    if (!request.account) throw new UnauthenticatedError();
    return { links: await listLinks(app.prisma, request.account.id) };
  });

  app.post('/links', { schema: { body: z.object({ label, url }) } }, async (request, reply) => {
    if (!request.account) throw new UnauthenticatedError();
    const link = await addLink(app.prisma, request.account.id, request.body);
    return reply.status(201).send({ link });
  });

  app.patch(
    '/links/:id',
    {
      schema: {
        params,
        body: z.object({ label: label.optional(), url: url.optional(), size: z.enum(TILE_SIZES).nullable().optional() }),
      },
    },
    async (request) => {
      if (!request.account) throw new UnauthenticatedError();
      return { link: await updateLink(app.prisma, request.account.id, request.params.id, request.body) };
    },
  );

  app.delete('/links/:id', { schema: { params } }, async (request) => {
    if (!request.account) throw new UnauthenticatedError();
    await removeLink(app.prisma, request.account.id, request.params.id);
    return { status: 'removed' };
  });

  app.put(
    '/links/order',
    { schema: { body: z.object({ ids: z.array(z.string().min(1).max(64)).max(200) }) } },
    async (request) => {
      if (!request.account) throw new UnauthenticatedError();
      await reorderLinks(app.prisma, request.account.id, request.body.ids);
      return { status: 'reordered' };
    },
  );
};
