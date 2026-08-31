import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { UnauthenticatedError } from '../../plugins/session.js';
import { editFact, rejectFact, verifyFact } from './fact.service.js';

const params = z.object({ id: z.string().min(1).max(64) });

export const factRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post('/facts/:id/verify', { schema: { params } }, async (request, reply) => {
    if (!request.account) throw new UnauthenticatedError();

    await verifyFact(app.prisma, request.account.id, request.params.id);
    return reply.send({ status: 'verified' });
  });

  app.patch(
    '/facts/:id',
    { schema: { params, body: z.object({ claim: z.string().min(1).max(500) }) } },
    async (request, reply) => {
      if (!request.account) throw new UnauthenticatedError();

      await editFact(app.prisma, request.account.id, request.params.id, request.body.claim);
      return reply.send({ status: 'updated' });
    },
  );

  app.post('/facts/:id/reject', { schema: { params } }, async (request, reply) => {
    if (!request.account) throw new UnauthenticatedError();

    await rejectFact(app.prisma, request.account.id, request.params.id);
    return reply.send({ status: 'rejected' });
  });
};
