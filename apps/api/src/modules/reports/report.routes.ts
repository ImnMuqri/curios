import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { REPORT_DETAILS_MAX } from '@curios/core';
import { reportPage } from './report.service.js';

const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

/** A visitor reporting a page. No session: a visitor has no account. */
export const reportRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/pages/:handle/report',
    {
      schema: {
        params: z.object({ handle: z.string().min(1).max(64) }),
        body: z.object({
          reason: z.enum(['SCAM', 'IMPERSONATION', 'WRONG_PRICES', 'OFFENSIVE', 'OTHER']),
          details: z.string().max(REPORT_DETAILS_MAX).optional(),
        }),
        response: { 400: errorSchema, 404: errorSchema },
      },
    },
    async (request, reply) => {
      await reportPage(app.prisma, request.params.handle, request.ip, request.body);
      // Nothing about the reporter in the log: the address is the one thing we hash.
      request.log.info({ handle: request.params.handle, reason: request.body.reason }, 'page reported');
      return reply.status(204).send();
    },
  );
};
