import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Embedder } from '@curios/embeddings';
import { createOpenAiEmbedder, EMBEDDING_BATCH_TIMEOUT_MS } from '@curios/embeddings';
import { UnauthenticatedError } from '../../plugins/session.js';
import { addFact, editFact, rejectFact, verifyFact } from './fact.service.js';

const params = z.object({ id: z.string().min(1).max(64) });

export interface FactRouteOptions {
  /**
   * `undefined` builds one from the environment, which is what production
   * does. `null` means no embedder: an edit then deletes the fact's vector
   * and the page falls back. Only tests pass null.
   */
  embedder?: Embedder | null;
}

export const factRoutes: FastifyPluginAsyncZod<FactRouteOptions> = async (app, options) => {
  let embedder = options.embedder;
  if (embedder === undefined) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY is not set');
    // An owner is watching a spinner, not a visitor watching a bubble, and
    // this embeds exactly one short string.
    embedder = createOpenAiEmbedder(apiKey, { timeoutMs: EMBEDDING_BATCH_TIMEOUT_MS });
  }

  app.post('/facts/:id/verify', { schema: { params } }, async (request, reply) => {
    if (!request.account) throw new UnauthenticatedError();

    await verifyFact(app.prisma, request.account.id, request.params.id);
    return reply.send({ status: 'verified' });
  });

  app.patch(
    '/facts/:id',
    { schema: { params, body: z.object({ claim: z.string().max(2000) }) } },
    async (request, reply) => {
      if (!request.account) throw new UnauthenticatedError();

      await editFact(
        app.prisma,
        request.account.id,
        request.params.id,
        request.body.claim,
        embedder,
        request.log,
      );
      return reply.send({ status: 'updated' });
    },
  );

  app.post('/facts/:id/reject', { schema: { params } }, async (request, reply) => {
    if (!request.account) throw new UnauthenticatedError();

    await rejectFact(app.prisma, request.account.id, request.params.id);
    return reply.send({ status: 'rejected' });
  });

  app.post(
    '/facts',
    // Size bounds only. The rules an owner can break -- empty, too long, an
    // unknown category -- are the service's, with their own code.
    { schema: { body: z.object({ category: z.string().max(32), claim: z.string().max(2000) }) } },
    async (request, reply) => {
      if (!request.account) throw new UnauthenticatedError();

      const result = await addFact(app.prisma, request.account.id, request.body, embedder, request.log);
      return reply.status(201).send(result);
    },
  );
};
