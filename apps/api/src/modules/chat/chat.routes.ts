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
      reply.raw.writeHead(200, {
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
