import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { PASTED_TEXT_MAX } from '@curios/core';
import { UnauthenticatedError } from '../../plugins/session.js';
import { getIngestion, startFromFile, startIngestion } from './ingest.service.js';
import { SOURCE_FILE_MAX_BYTES } from './file-text.js';
import { createHostGuard, type HostGuard } from './host-guard.js';

const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

export interface IngestRouteOptions {
  guard?: HostGuard;
}

export const ingestRoutes: FastifyPluginAsyncZod<IngestRouteOptions> = async (app, options) => {
  // One guard for the lifetime of the app, so the env flag is read once rather
  // than per request, where it could change under a running crawl.
  const guard = options.guard ?? createHostGuard();

  app.post(
    '/ingest',
    {
      schema: {
        // pageId is capped because it becomes a Redis key with a day-long TTL in
        // the per-page rate limiter; a cuid is 25 characters.
        body: z
          .object({
            pageId: z.string().min(1).max(64),
            sourceUrl: z.string().min(1).max(2048).optional(),
            pastedText: z.string().trim().min(1).max(PASTED_TEXT_MAX).optional(),
          })
          // Exactly one source, refused here before anything is written. The
          // Ingestion_one_source constraint holds if anything writes around this.
          .refine((body) => (body.sourceUrl === undefined) !== (body.pastedText === undefined), {
            message: 'Send a website address or pasted text, one or the other.',
          }),
        response: { 202: z.object({ ingestionId: z.string() }), 400: errorSchema },
      },
    },
    async (request, reply) => {
      // The session is required on the scope, in app.ts, so this cannot be
      // reached without one. Narrowed rather than asserted: a non-null
      // assertion here would survive someone moving that hook.
      if (!request.account) throw new UnauthenticatedError();

      const result = await startIngestion(
        { prisma: app.prisma, queue: app.ingestQueue, guard },
        request.account.id,
        request.body,
      );
      return reply.status(202).send(result);
    },
  );

  // A file as a source (a resume, a menu): sent as base64 JSON, the way the
  // picture uploads are, so the same body parser and limits apply. Base64
  // grows a file by a third; the limit leaves room for the JSON around it.
  app.post(
    '/ingest/file',
    {
      bodyLimit: Math.ceil((SOURCE_FILE_MAX_BYTES * 4) / 3) + 64 * 1024,
      schema: {
        body: z.object({
          pageId: z.string().min(1).max(64),
          fileName: z.string().min(1).max(255),
          data: z.string().min(1).max(Math.ceil((SOURCE_FILE_MAX_BYTES * 4) / 3) + 4),
        }),
        response: { 202: z.object({ ingestionId: z.string(), truncated: z.boolean() }), 400: errorSchema },
      },
    },
    async (request, reply) => {
      if (!request.account) throw new UnauthenticatedError();
      const result = await startFromFile(
        { prisma: app.prisma, queue: app.ingestQueue, guard },
        request.account.id,
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
            // Null for an ingestion from pasted text.
            sourceUrl: z.string().nullable(),
          }),
          404: errorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!request.account) throw new UnauthenticatedError();

      const result = await getIngestion(app.prisma, request.account.id, request.params.id);
      if (!result) {
        return reply
          .status(404)
          .send({ error: { code: 'NOT_FOUND', message: 'No such ingestion.' } });
      }
      return reply.send(result);
    },
  );
};
