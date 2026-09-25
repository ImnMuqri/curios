import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { conversationCap } from '@curios/core';
import { createAnthropicGateway, type Gateway } from '@curios/gateway';
import { createOpenAiEmbedder, type Embedder } from '@curios/embeddings';
import { answer } from './chat.service.js';

export interface ChatRouteOptions {
  /**
   * Injected only by tests. Without it this route builds its gateway from the
   * environment at registration time, which made it the one route in the app
   * that could not be tested without either an API key or real model spend.
   */
  gateway?: Gateway;
  /**
   * `undefined` builds one from the environment, as production does. `null`
   * means retrieval is off and every page sends every fact -- correct, and
   * about seven times the cost. Only tests pass null.
   */
  embedder?: Embedder | null;
}

export const chatRoutes: FastifyPluginAsyncZod<ChatRouteOptions> = async (app, options) => {
  let gateway = options.gateway;
  if (!gateway) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
    gateway = createAnthropicGateway(apiKey);
  }

  // Resolved once here, at registration -- the same moment the API key above
  // is checked, and for the same reason: this route already builds its
  // dependencies from the environment at boot rather than per request, which
  // is what lets a bad value fail the deploy instead of one visitor's chat.
  // `conversationCap()` throws on a malformed CONVERSATION_CAP_PER_MONTH; see
  // ChatDeps.cap in chat.service.ts for what calling it per request used to
  // cost.
  const cap = conversationCap();

  // Resolved at registration for the reason the API key and the cap above are:
  // a missing key should fail the deploy, not one visitor's question. It is
  // required rather than optional-with-a-warning because the failure is
  // invisible from outside -- every page would quietly answer from every fact
  // at seven times the cost, and look completely healthy doing it.
  let embedder = options.embedder;
  if (embedder === undefined) {
    const openAiKey = process.env.OPENAI_API_KEY;
    if (!openAiKey) throw new Error('OPENAI_API_KEY is not set');
    embedder = createOpenAiEmbedder(openAiKey);
  }

  app.post(
    '/chat/:handle',
    {
      schema: {
        params: z.object({ handle: z.string() }),
        body: z.object({
          question: z.string().min(1).max(500),
          // Capped because it becomes a database lookup key. A cuid is 25
          // characters; the ceiling is for whatever is not one.
          conversationId: z.string().min(1).max(64).optional(),
        }),
      },
    },
    async (request, reply) => {
      // hijack() takes the raw response out of Fastify's own reply lifecycle --
      // required for a manual setHeader()/writeHead()/write()/end() sequence
      // like this one. Without it, Fastify's own reply handling (which never
      // runs, because we never call reply.send()) leaves the socket in an
      // inconsistent state.
      //
      // reply.getHeaders() is copied onto the raw response deliberately:
      // @fastify/cors sets Access-Control-Allow-Origin (and friends) via
      // reply.header() in an onRequest hook, which writes into Fastify's
      // internal header store (kReplyHeaders). That store is normally flushed
      // onto the socket by reply.send(), which this handler never calls.
      // Calling reply.raw.writeHead(200, {...}) directly -- without first
      // copying getHeaders() onto the raw response -- silently drops every
      // header the cors hook set, so the browser rejects the response with no
      // CORS header. Do not "simplify" this away.
      reply.hijack();
      for (const [name, value] of Object.entries(reply.getHeaders())) {
        if (value !== undefined) reply.raw.setHeader(name, value);
      }
      reply.raw.setHeader('content-type', 'text/event-stream');
      reply.raw.setHeader('cache-control', 'no-cache, no-transform');
      reply.raw.setHeader('connection', 'keep-alive');
      reply.raw.writeHead(200);

      const stream = answer(
        { prisma: app.prisma, gateway, cap, embedder, log: request.log },
        {
          handle: request.params.handle,
          question: request.body.question,
          conversationId: request.body.conversationId,
        },
      );

      // Headers are already sent by the time a stream can fail, so a thrown
      // error cannot become a 500 -- it is written into the stream as an event
      // and the stream is ended cleanly either way.
      try {
        for await (const event of stream) {
          reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
        }
      } catch (error) {
        request.log.error({ err: error }, 'chat stream failed');
        // The code travels with the message so the client can act on one
        // specific failure: a dead conversation id has to be dropped, or every
        // later turn carries it and fails too. The visitor-facing text is the
        // same either way -- only the client's own bookkeeping differs.
        const code =
          error instanceof Error && 'code' in error && typeof error.code === 'string'
            ? error.code
            : undefined;
        reply.raw.write(
          `data: ${JSON.stringify({
            type: 'error',
            code,
            message: 'That answer failed. Try again.',
          })}\n\n`,
        );
      } finally {
        reply.raw.end();
      }
    },
  );
};
