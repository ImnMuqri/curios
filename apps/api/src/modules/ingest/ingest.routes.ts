import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getIngestion, startIngestion } from './ingest.service.js';

const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

export const ingestRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/ingest',
    {
      schema: {
        // pageId is capped because it becomes a Redis key with a day-long TTL in
        // the per-page rate limiter; a cuid is 25 characters.
        body: z.object({ pageId: z.string().min(1).max(64), sourceUrl: z.string().min(1).max(2048) }),
        response: { 202: z.object({ ingestionId: z.string() }), 400: errorSchema },
      },
    },
    async (request, reply) => {
      const result = await startIngestion(
        { prisma: app.prisma, queue: app.ingestQueue },
        request.body,
      );
      return reply.status(202).send(result);
    },
  );

  app.get(
    '/ingest/:id',
    {
      // Polling a status costs nothing -- no crawl, no model call -- so it is
      // exempt from the limiters guarding this scope. Sharing them would let an
      // owner watching their own ingestion exhaust the budget for starting the
      // next one, and a GET has no body for the per-page limiter to key on.
      config: { rateLimit: false },
      schema: {
        params: z.object({ id: z.string() }),
        response: {
          200: z.object({
            id: z.string(),
            status: z.enum(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED']),
            extractedCount: z.number(),
            error: z.string().nullable(),
            sourceUrl: z.string(),
          }),
          404: errorSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await getIngestion(app.prisma, request.params.id);
      if (!result) {
        return reply
          .status(404)
          .send({ error: { code: 'NOT_FOUND', message: 'No such ingestion.' } });
      }
      return reply.send(result);
    },
  );
};
