import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { retryFailedSources, retrySource, type AdminSourcesDeps } from './admin-sources.service.js';
import { adminActor } from './audit.js';

const params = z.object({ id: z.string().min(1).max(64) });
const withReason = z.object({ reason: z.string().trim().min(1).max(500) });

/** Every route here sits behind requireAdmin, added by the scope that registers this plugin. */
export const adminSourcesRoutes: FastifyPluginAsyncZod = async (app) => {
  const deps = async (log?: AdminSourcesDeps['log']): Promise<AdminSourcesDeps> => ({
    prisma: app.prisma,
    queue: app.ingestQueue,
    settings: await app.settings.get(),
    log,
  });

  // Registered first: a static segment wins over :id in find-my-way either way, but the order reads as intended.
  app.post('/admin/sources/retry-failed', { schema: { body: withReason } }, async (request) =>
    retryFailedSources(await deps(request.log), adminActor(request), request.body.reason),
  );

  app.post('/admin/sources/:id/retry', { schema: { params, body: withReason } }, async (request, reply) => {
    await retrySource(await deps(), adminActor(request), request.params.id, request.body.reason);
    return reply.status(204).send();
  });
};
