import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { UnauthenticatedError } from '../../plugins/session.js';
import { addNeverSay, removeNeverSay } from './never-say.service.js';

export const neverSayRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/never-say',
    { schema: { body: z.object({ phrase: z.string().max(1000) }) } },
    async (request, reply) => {
      if (!request.account) throw new UnauthenticatedError();
      return reply.status(201).send(await addNeverSay(app.prisma, request.account.id, request.body.phrase));
    },
  );

  app.delete(
    '/never-say/:id',
    { schema: { params: z.object({ id: z.string().min(1).max(64) }) } },
    async (request, reply) => {
      if (!request.account) throw new UnauthenticatedError();
      await removeNeverSay(app.prisma, request.account.id, request.params.id);
      return reply.send({ status: 'removed' });
    },
  );
};
