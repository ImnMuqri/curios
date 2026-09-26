import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { HEADING_FONTS, PAGE_STYLES } from '@curios/core/bento';
import { UnauthenticatedError } from '../../plugins/session.js';
import { updateAppearance } from './appearance.service.js';
import { claimHandle, publishPage, setSearchIndexing, upgradeToBusiness } from './page.service.js';

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
          // Optional so existing callers keep working; absent means BUSINESS,
          // the column's own default.
          mode: z.enum(['PERSONAL', 'BUSINESS']).optional(),
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

  app.post('/publish', async (request, reply) => {
    if (!request.account) throw new UnauthenticatedError();

    await publishPage(app.prisma, request.account.id);
    return reply.send({ status: 'published' });
  });

  app.post('/pages/upgrade', async (request, reply) => {
    if (!request.account) throw new UnauthenticatedError();

    await upgradeToBusiness(app.prisma, request.account.id);
    return reply.send({ status: 'business' });
  });

  app.patch(
    '/pages/search-indexing',
    { schema: { body: z.object({ allow: z.boolean() }) } },
    async (request, reply) => {
      if (!request.account) throw new UnauthenticatedError();

      await setSearchIndexing(app.prisma, request.account.id, request.body.allow);
      return reply.send({ allowSearchIndexing: request.body.allow });
    },
  );

  app.patch(
    '/pages/appearance',
    {
      schema: {
        body: z.object({
          style: z.enum(PAGE_STYLES).optional(),
          accentColor: z.string().max(40).optional(),
          headingFont: z.enum(HEADING_FONTS).optional(),
          displayName: z.string().max(400).optional(),
          bio: z.string().max(2000).nullable().optional(),
        }),
      },
    },
    async (request) => {
      if (!request.account) throw new UnauthenticatedError();
      return { appearance: await updateAppearance(app.prisma, request.account.id, request.body) };
    },
  );
};
