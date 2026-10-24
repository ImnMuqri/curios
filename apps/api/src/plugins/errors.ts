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
  // A suspended page: chat, leads, orders, paying and receipts all answer this (410).
  'PAGE_UNAVAILABLE',
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
  // Admin sign-in: one answer for an unknown email, a wrong password and a disabled admin.
  'ADMIN_SIGNIN_FAILED',
  // Admin actions: the page is not there, is not in a state the action allows, or the typed handle is not its handle.
  'PAGE_STATE',
  'HANDLE_MISMATCH',
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
  // Never-say: a phrase that is not one short line, one already listed, or one too many.
  'INVALID_NEVER_SAY',
  'NEVER_SAY_DUPLICATE',
  'NEVER_SAY_LIMIT',
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
  // Topics: an answer or title that fails its rule, a split of a lone wording,
  // a resolve with nothing to resolve.
  'INVALID_ANSWER',
  'INVALID_TITLE',
  'ALREADY_ALONE',
  'NO_CONFLICT',
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
  // Listed so the code survives the trip -- the web app turns it into "CHIP is not
  // answering". Unlike OAUTH_EXCHANGE_FAILED, an outage is worth waiting out, and a
  // misconfiguration never becomes this code: the CHIP client throws a plain Error
  // for a 4xx, which stays INTERNAL_ERROR.
  'CHIP_UNAVAILABLE',
  // Development only: billing switched off because no CHIP_* setting is present
  // (billingDisabled in @curios/billing). A 503 for the same reason as the one above,
  // and listed for the same reason: the web app says what is actually true rather than
  // "something failed on our side".
  'BILLING_NOT_CONFIGURED',
  // Development only: pictures switched off because no STORAGE_* setting is present
  // (storageDisabled in ./modules/pages/storage.js). A 503 for the same reason as the
  // one above, and listed for the same reason: the web app says what is actually true
  // rather than "something failed on our side".
  'STORAGE_NOT_CONFIGURED',
  // The shop (slice 17): each says what the owner can change.
  'STORE_BUSINESS_ONLY',
  'STORE_NOT_READY',
  'INVALID_STORE_SETTING',
  'INVALID_ITEM',
  'ITEM_LIMIT',
  'ITEM_ORDER_STALE',
  // Digital items: files, codes and session times (each says what to change).
  'TOO_MANY_FILES',
  'FILE_TOO_BIG',
  'FILE_TYPE',
  'INVALID_FILE',
  'WRONG_DELIVERY',
  'INVALID_CODES',
  'CODE_USED',
  'INVALID_SESSION',
  'SEATS_BOOKED',
  'SESSION_BOOKED',
  'ITEM_HAS_BOOKINGS',
  'ITEM_HAS_SALES',
  // Placing an order (slice 18): each tells the visitor what to do next --
  // order on WhatsApp, reload the basket, or fix one field.
  'STORE_CLOSED',
  'ORDERS_PAUSED',
  'PRICES_CHANGED',
  'ITEM_UNAVAILABLE',
  'ORDER_DATE',
  'METHOD_OFF',
  'ADDRESS_REQUIRED',
  'ORDER_TOO_LARGE',
  // Digital lines (slice 19): sold out, a full class time, a missing email, or a basket whose shape contradicts its method and day.
  'SOLD_OUT',
  'TIME_FULL',
  'TIME_REQUIRED',
  'EMAIL_REQUIRED',
  'INVALID_ORDER',
  // Downloading what was bought (slice 19): the order is not paid, or the grant is spent or old.
  'ORDER_NOT_PAID',
  'DOWNLOAD_USED_UP',
  'DOWNLOAD_EXPIRED',
  // A receipt on the order link (slice 18).
  'ORDER_NOT_FOUND',
  'INVALID_RECEIPT',
  'ORDER_ALREADY_PAID',
  'ORDER_CANCELLED',
  'ORDER_RECEIPT_SENT',
  'ORDER_STATE',
  // Connecting the owner's own CHIP account (Store -> Payment): each says what to fix --
  // the key's shape, the key CHIP refused, a test key in production, an account with
  // nothing to test with, a test CHIP would not start, or nothing connected yet.
  'INVALID_CHIP_KEY',
  'CHIP_KEY_REFUSED',
  'CHIP_TEST_KEY',
  'CHIP_NO_TEST_METHOD',
  'CHIP_NO_CHECK_METHOD',
  'CHIP_PAYMENT_IN_FLIGHT',
  'ORDER_JUST_PAID',
  'CHIP_TEST_REFUSED',
  'CHIP_NOT_CONNECTED',
  // The kept key will not open (PAYMENT_SECRETS_KEY rotated): connect again.
  'CHIP_RECONNECT',
  // Development only, as BILLING_NOT_CONFIGURED: no PAYMENT_SECRETS_KEY to seal a key with.
  'CHIP_NOT_CONFIGURED',
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
