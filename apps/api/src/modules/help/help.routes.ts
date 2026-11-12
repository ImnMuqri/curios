import { HELP_SCREENS } from '@curios/core/help';
import { createAnthropicGateway, type Gateway } from '@curios/gateway';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { UnauthenticatedError } from '../../plugins/session.js';
import { answerFeedback, askHelp, guideForPanel, sendToSupport, viewTopic } from './help.service.js';

export interface HelpRouteOptions {
  /** Tests pass a stub; otherwise the Anthropic gateway, as the chat uses. */
  gateway?: Gateway;
}

const screen = z.enum(HELP_SCREENS);
const id = z.string().min(1).max(64);

/**
 * The dashboard's Help chat: the owner's own questions, signed in. Three scopes in app.ts, because
 * asking (a model call) and sending to support (a thread a person reads) each have their own
 * per-account limit, and reading the guide, picking a topic and Yes/No have none.
 */
export const helpAskRoutes: FastifyPluginAsyncZod<HelpRouteOptions> = async (app, options) => {
  let gateway = options.gateway;
  if (!gateway) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
    gateway = createAnthropicGateway(apiKey);
  }
  const help = gateway;

  app.post(
    '/help/ask',
    {
      schema: {
        body: z.object({
          question: z.string().trim().min(1).max(500),
          screen,
          history: z
            .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(2000) }))
            .max(6)
            .default([]),
        }),
      },
    },
    async (request) => {
      if (!request.account) throw new UnauthenticatedError();
      return askHelp(
        { prisma: app.prisma, gateway: help, settings: await app.settings.get(), log: request.log },
        { accountId: request.account.id, question: request.body.question, screen: request.body.screen, history: request.body.history },
      );
    },
  );
};

export const helpSupportRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/help/support',
    { schema: { body: z.object({ id: id.optional(), note: z.string().max(2000).optional(), screen }) } },
    async (request, reply) => {
      if (!request.account) throw new UnauthenticatedError();
      const sent = await sendToSupport(app.prisma, { accountId: request.account.id, ...request.body });
      return reply.status(201).send(sent);
    },
  );
};

export const helpRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/help/guide', async (request) => {
    if (!request.account) throw new UnauthenticatedError();
    return guideForPanel(await app.settings.get());
  });

  app.post(
    '/help/topic',
    { schema: { body: z.object({ entryId: z.string().min(1).max(64), screen }) } },
    async (request, reply) => {
      if (!request.account) throw new UnauthenticatedError();
      const row = await viewTopic({ prisma: app.prisma, settings: await app.settings.get() }, { accountId: request.account.id, ...request.body });
      return reply.status(201).send(row);
    },
  );

  app.post(
    '/help/:id/feedback',
    { schema: { params: z.object({ id }), body: z.object({ helped: z.boolean() }) } },
    async (request) => {
      if (!request.account) throw new UnauthenticatedError();
      await answerFeedback(app.prisma, { accountId: request.account.id, id: request.params.id, helped: request.body.helped });
      return { status: 'saved' };
    },
  );
};
