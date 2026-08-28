import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getIngestion, startIngestion } from './ingest.service.js';

const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

export const ingestRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/ingest',
    {
      schema: {
        body: z.object({ pageId: z.string().min(1), sourceUrl: z.string().min(1) }),
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
