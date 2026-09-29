import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { UnauthenticatedError } from '../../plugins/session.js';
import { recheckSource, removeSource } from './source.service.js';

const params = z.object({ id: z.string().min(1).max(64) });

/** Owner scope. Removing spends nothing, so it needs no ingest limiter. */
export const sourceRoutes: FastifyPluginAsyncZod = async (app) => {
  app.delete('/sources/:id', { schema: { params } }, async (request, reply) => {
    if (!request.account) throw new UnauthenticatedError();
    return reply.send(await removeSource(app.prisma, request.account.id, request.params.id));
  });
};

/**
 * Ingest scope: a re-check crawls and spends a model call, exactly like
 * POST /ingest, so it shares that scope's per-IP and per-page limiters.
 */
export const sourceRecheckRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post('/sources/:id/recheck', { schema: { params } }, async (request, reply) => {
    if (!request.account) throw new UnauthenticatedError();
    const result = await recheckSource({ prisma: app.prisma, queue: app.ingestQueue }, request.account.id, request.params.id);
    return reply.status(202).send(result);
  });
};
