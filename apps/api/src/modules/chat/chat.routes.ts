import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { createAnthropicGateway } from '@curios/gateway';
import { answer } from './chat.service.js';

export const chatRoutes: FastifyPluginAsyncZod = async (app) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  const gateway = createAnthropicGateway(apiKey);

  app.post(
    '/chat/:handle',
    {
      schema: {
        params: z.object({ handle: z.string() }),
        body: z.object({ question: z.string().min(1).max(500) }),
      },
    },
    async (request, reply) => {
      // hijack() takes the raw response out of Fastify's own reply lifecycle --
      // required for a manual writeHead()/write()/end() sequence like this one.
      // Without it, Fastify's own reply handling (which never runs, because we
      // never call reply.send()) leaves the socket in an inconsistent state.
      //
      // getHeaders() is spread in deliberately: @fastify/cors sets
      // Access-Control-Allow-Origin (and friends) via reply.header() in an
      // onRequest hook, which writes into Fastify's internal header store
      // (kReplyHeaders). That store is normally flushed onto the socket by
      // reply.send(), which this handler never calls. Writing the response
      // headers directly with reply.raw.writeHead(200, {...}) -- without this
      // spread -- silently drops every header the cors hook set, so the
      // browser rejects the response with no CORS header. Do not "simplify"
      // this away.
      reply.hijack();
      reply.raw.writeHead(200, {
        ...reply.getHeaders(),
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      });

      const stream = answer(
        { prisma: app.prisma, gateway },
        { handle: request.params.handle, question: request.body.question },
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
        reply.raw.write(
          `data: ${JSON.stringify({ type: 'error', message: 'That answer failed. Try again.' })}\n\n`,
        );
      } finally {
        reply.raw.end();
      }
    },
  );
};
