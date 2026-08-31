import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { UnauthenticatedError } from '../../plugins/session.js';
import { claimHandle } from './page.service.js';

export const pageRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/pages',
    {
      schema: {
        body: z.object({
          // Deliberately NOT HANDLE_MIN/HANDLE_MAX. Schema validation runs
          // before the handler, so bounding the handle here means a too-short
          // handle never reaches `checkHandle` and comes back as a Fastify
          // validation error -- which `errorsPlugin` does not whitelist, so the
          // caller is told INTERNAL_ERROR for typing two characters.
          //
          // The 200 is an abuse bound on the payload, nothing more. Every real
          // decision about what a handle may be belongs to `checkHandle`, which
          // has a code and a message that say what the rule is.
          handle: z.string().min(1).max(200),
          displayName: z.string().min(1).max(80),
        }),
      },
    },
    async (request, reply) => {
      // Required on the scope in app.ts. Narrowed rather than asserted, so a
      // non-null assertion cannot outlive someone moving that hook.
      if (!request.account) throw new UnauthenticatedError();

      const result = await claimHandle(app.prisma, request.account.id, request.body);
      return reply.status(201).send(result);
    },
  );
};
