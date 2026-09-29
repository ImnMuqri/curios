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
  // A fact the owner typed that is empty, too long, or has no real category.
  'INVALID_FACT',
  'NO_PAGE',
  // Knowledge: a source that is being read cannot be removed or re-read, and
  // pasted text has nothing to re-read.
  'SOURCE_BUSY',
  'SOURCE_NOT_RECHECKABLE',
  // My Curios: a link an owner typed wrong, one too many, or an order from a
  // tab that is behind. Each says what to do next.
  'INVALID_LINK',
  'LINK_LIMIT',
  'LINK_ORDER_STALE',
  // A style, colour, font, name or bio an owner sent that fails its own rule.
  'INVALID_APPEARANCE',
  // A file for the profile picture that is too big, the wrong type, or whose
  // bytes disagree with the type it claimed. The old picture is kept either way.
  'INVALID_IMAGE',
  'PASSWORD_ALREADY_SET',
  // The one trial reset, already spent -- or asked for by a page that is not
  // entitled to it. 409 rather than 403: nothing is forbidden about the caller,
  // the thing they are asking for is simply gone. The message says which.
  'TRIAL_RESET_USED',
  'IDENTITY_TAKEN',
  // Starting a payment on a personal page. It says what is true: there is nothing
  // to pay for.
  'NOT_A_BUSINESS_PAGE',
  // A 502, so the handler below still replaces its message with the generic sentence.
  // Listed so the code survives the trip -- the web app turns it into "Billplz is not
  // answering". Unlike OAUTH_EXCHANGE_FAILED, an outage is worth waiting out, and a
  // misconfiguration never becomes this code: the Billplz client throws a plain Error
  // for a 4xx, which stays INTERNAL_ERROR.
  'BILLPLZ_UNAVAILABLE',
  // Development only: billing switched off because no BILLPLZ_* setting is present
  // (billingDisabled in @curios/billing). A 503 for the same reason as the one above,
  // and listed for the same reason: the web app says what is actually true rather than
  // "something failed on our side".
  'BILLING_NOT_CONFIGURED',
  // Development only: pictures switched off because no STORAGE_* setting is present
  // (storageDisabled in ./modules/pages/storage.js). A 503 for the same reason as the
  // one above, and listed for the same reason: the web app says what is actually true
  // rather than "something failed on our side".
  'STORAGE_NOT_CONFIGURED',
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
