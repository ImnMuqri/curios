import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { UnauthenticatedError } from '../../plugins/session.js';
import { answerQuestion } from './question.service.js';

export const questionRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/questions/:id/answer',
    {
      schema: {
        params: z.object({ id: z.string().min(1).max(64) }),
        // 2000, not the 500 a fact claim gets. This is one of the two places
        // FRONTEND.md says a human writes real prose, and an owner explaining
        // a delivery policy needs more room than a single claim.
        body: z.object({ answer: z.string().min(1).max(2000) }),
      },
    },
    async (request, reply) => {
      // The session is required on the scope, in app.ts, so this cannot be
      // reached without one. Narrowed rather than asserted: a non-null
      // assertion here would survive someone moving that hook.
      if (!request.account) throw new UnauthenticatedError();

      await answerQuestion(
        app.prisma,
        request.account.id,
        request.params.id,
        request.body.answer,
        request.log,
      );
      return reply.send({ status: 'answered' });
    },
  );
};
