import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { captureLead } from './lead.service.js';

const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

export const leadRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/leads',
    {
      schema: {
        body: z.object({
          conversationId: z.string().min(1).max(64),
          phone: z.string().min(1).max(24),
          // Present and true or the schema refuses the request. PDPA consent
          // is something the visitor did, not a default we assume on their
          // behalf, and a boolean that could be false would be exactly that.
          consent: z.literal(true),
        }),
        response: {
          201: z.object({ leadId: z.string() }),
          400: errorSchema,
          409: errorSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await captureLead(
        { prisma: app.prisma, queue: app.leadQueue },
        { conversationId: request.body.conversationId, phone: request.body.phone },
      );
      // The id and nothing else. BACKEND.md asks that phone numbers stay out
      // of application logs, and logging a request body on the way past is
      // exactly how that gets violated without anyone deciding to.
      request.log.info({ leadId: result.leadId }, 'lead captured');
      return reply.status(201).send(result);
    },
  );
};
