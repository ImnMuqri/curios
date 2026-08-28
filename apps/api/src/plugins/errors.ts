import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

interface DomainError extends Error {
  statusCode?: number;
  code?: string;
}

/**
 * Domain errors are mapped once, here. Messages are user-facing and follow the
 * copy rules: say what happened and what to do next, never apologise.
 */
export const errorsPlugin = fp(async (app: FastifyInstance) => {
  app.setErrorHandler((error: DomainError, request, reply) => {
    const statusCode = error.statusCode ?? 500;
    const code = error.code ?? 'INTERNAL_ERROR';

    if (statusCode >= 500) request.log.error({ err: error }, 'unhandled error');

    return reply.status(statusCode).send({
      error: {
        code,
        message: statusCode >= 500 ? 'Something failed on our side. Try again.' : error.message,
      },
    });
  });
});
