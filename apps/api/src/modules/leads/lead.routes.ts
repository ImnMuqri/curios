import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { UnauthenticatedError } from '../../plugins/session.js';
import { captureLead, deleteLead, setLeadStatus } from './lead.service.js';

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
          410: errorSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await captureLead(
        { prisma: app.prisma, queue: app.leadQueue, settings: await app.settings.get() },
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

/**
 * Owner actions on leads. A separate plugin from `leadRoutes` because that one
 * is registered in an anonymous, rate-limited scope for the visitor's POST,
 * and this must sit behind requireSession. Same path prefix, different method
 * and different scope; Fastify routes on both.
 */
export const ownerLeadRoutes: FastifyPluginAsyncZod = async (app) => {
  app.patch(
    '/leads/:id',
    {
      schema: {
        params: z.object({ id: z.string().min(1).max(64) }),
        body: z.object({ status: z.enum(['NEW', 'CONTACTED', 'SOLD', 'CLOSED']) }),
      },
    },
    async (request, reply) => {
      if (!request.account) throw new UnauthenticatedError();

      await setLeadStatus(app.prisma, request.account.id, request.params.id, request.body.status);
      request.log.info({ leadId: request.params.id, status: request.body.status }, 'lead status set');
      return reply.send({ status: request.body.status });
    },
  );

  app.delete(
    '/leads/:id',
    { schema: { params: z.object({ id: z.string().min(1).max(64) }) } },
    async (request, reply) => {
      if (!request.account) throw new UnauthenticatedError();

      await deleteLead(app.prisma, request.account.id, request.params.id);
      // The id and nothing else. A phone number must not reach the log, and
      // logging the deleted row on the way past is exactly how that happens.
      request.log.info({ leadId: request.params.id }, 'lead deleted');
      return reply.send({ status: 'deleted' });
    },
  );
};
