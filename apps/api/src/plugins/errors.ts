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
//
// Exported because the OAuth callback (`auth.routes.ts`) needs the same
// answer to the same question -- "which codes may reach a client" -- for the
// error code it puts on a redirect's query string. It used to keep a second,
// hand-maintained copy of that answer; the two disagreed, which is what let
// `OAUTH_EXCHANGE_FAILED` (deliberately absent here, see below) reach the
// browser anyway. One list now, and this is it.
export const DOMAIN_ERROR_CODES = new Set([
  'PAGE_NOT_FOUND',
  // Reaches a client through the SSE error event rather than a status code:
  // headers are already sent by the time the chat service can throw. Listed
  // here anyway, because this set is the one answer to "which codes may reach
  // a client", and the chat route reads it for the same reason the OAuth
  // callback does.
  'CONVERSATION_NOT_FOUND',
  'INVALID_SOURCE_URL',
  // Distinct from INVALID_SOURCE_URL on purpose: "that is not a website" and
  // "that website is somewhere we will not go" are different problems, and the
  // owner can only fix one of them. Client-facing, because the alternative is
  // a shop owner staring at "something failed on our side" for a URL they can
  // see is fine. What it concedes -- that a caller learns whether a name
  // resolves privately -- is argued in devDocs/ssrf-ingest-guard-design.md.
  'BLOCKED_SOURCE_URL',
  // The three a visitor can see on the capture card. Each says what to do
  // next: fix the number, keep chatting, or stop because the shop already has
  // it. A generic INTERNAL_ERROR on any of them would read as the product
  // being broken at the moment it is trying to earn its keep.
  'INVALID_PHONE',
  'NOT_QUALIFIED',
  'ALREADY_CAPTURED',
  'EMAIL_NOT_VERIFIED',
  'RATE_LIMITED',
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  'WEAK_PASSWORD',
  'INVALID_TOKEN',
  'OAUTH_STATE_MISMATCH',
  'NOT_FOUND',
  'HANDLE_INVALID',
  'HANDLE_RESERVED',
  'HANDLE_TAKEN',
  'HANDLE_TOO_SIMILAR',
  'PAGE_EXISTS',
  'FACT_DUPLICATE',
  'NO_PAGE',
  'PASSWORD_ALREADY_SET',
  'IDENTITY_TAKEN',
  // `OAUTH_EXCHANGE_FAILED` (`OAuthExchangeError`, oauth.service.ts) is
  // deliberately NOT here. It is a 502 -- Google answered, but the exchange
  // itself failed, typically a misconfigured client secret or redirect URI --
  // and the whole point of giving it its own class and status code was to
  // keep it out of this allow-list, so it renders as the generic
  // "something failed on our side" below instead of a specific, reassuring
  // message that tells every affected user to just try again. Do not add it
  // here as a kindness; that undoes the reason it exists.
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
