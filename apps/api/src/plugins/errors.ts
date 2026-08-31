import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

interface DomainError extends Error {
  statusCode?: number;
  code?: string;
}

// Every code a domain error in this codebase actually throws with. Anything
// else -- a raw Prisma code (P2002, P2003, ...), a Node system error code, or
// anything unanticipated -- is not client-facing and must not be echoed back
// as-is, even on a 4xx.
const DOMAIN_ERROR_CODES = new Set([
  'PAGE_NOT_FOUND',
  'INVALID_SOURCE_URL',
  'EMAIL_NOT_VERIFIED',
  'RATE_LIMITED',
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  'WEAK_PASSWORD',
  'INVALID_TOKEN',
  'OAUTH_STATE_MISMATCH',
]);

/**
 * Domain errors are mapped once, here. Messages are user-facing and follow the
 * copy rules: say what happened and what to do next, never apologise.
 */
export const errorsPlugin = fp(async (app: FastifyInstance) => {
  app.setErrorHandler((error: DomainError, request, reply) => {
    const statusCode = error.statusCode ?? 500;
    const code =
      error.code && DOMAIN_ERROR_CODES.has(error.code) ? error.code : 'INTERNAL_ERROR';

    // The real code -- Prisma's included -- stays in the server-side log
    // regardless of what the client receives.
    if (statusCode >= 500) request.log.error({ err: error }, 'unhandled error');

    return reply.status(statusCode).send({
      error: {
        code,
        message: statusCode >= 500 ? 'Something failed on our side. Try again.' : error.message,
      },
    });
  });
});
