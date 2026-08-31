import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import IORedis from 'ioredis';
import { normalizeIP, type RateLimitPluginOptions } from '@fastify/rate-limit';

declare module 'fastify' {
  interface FastifyInstance {
    rateLimitRedis: IORedis;
  }
}

/**
 * Rate limiting exists here for one reason: money.
 *
 * `POST /chat/:handle` is anonymous by design -- a visitor has no account and
 * never will -- so it can never be put behind a session cookie. Every call
 * spends Haiku tokens, and every `POST /ingest` spends Opus tokens over a whole
 * crawled site. Without a limit, an anonymous loop bills the owner without
 * bound. This is a wallet control, not a permission control.
 *
 * Only the two endpoints that spend tokens are limited. `GET /ingest/:id` is
 * deliberately not: polling a status costs nothing, and an owner watching their
 * own ingestion must never exhaust the budget for starting the next one.
 */

/** Fail closed. Pinned rather than inherited: the plugin's default is already
 * false, but this is the one setting whose silent change would turn every paid
 * route loose during a Redis outage, which is exactly when that is worst. */
const FAIL_CLOSED = { skipOnError: false } as const;

class RateLimitedError extends Error {
  readonly statusCode = 429;
  readonly code = 'RATE_LIMITED';

  constructor(message: string) {
    super(message);
    this.name = 'RateLimitedError';
  }
}

/**
 * The rejection is thrown, so it lands in `errorsPlugin` and comes out in the
 * same `{ error: { code, message } }` envelope as every other error this API
 * returns. That plugin whitelists client-facing codes, so `RATE_LIMITED` must
 * stay listed there or a throttled visitor is told the server broke instead of
 * being asked to wait.
 */
function tooMany(sentence: (after: string) => string) {
  return (_request: FastifyRequest, context: { after: string }) =>
    new RateLimitedError(sentence(context.after));
}

/**
 * The caller's address, collapsed to its /64 when it is IPv6.
 *
 * A routed /64 is the ordinary allocation for a home line or a cheap VPS, so
 * without this an attacker rotates the low bits and earns a fresh budget per
 * address at no cost -- which removes the limit entirely. The plugin does this
 * for its own default key generator only, and every generator here is custom.
 */
function caller(request: FastifyRequest): string {
  return normalizeIP(request.ip);
}

function limit(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer, got ${JSON.stringify(raw)}`);
  }
  return parsed;
}

function namespace(suffix: string): string {
  return `${process.env.RATE_LIMIT_NAMESPACE ?? 'curios-rl:'}${suffix}`;
}

/**
 * Opens the Redis connection the limiters share.
 *
 * Deliberately NOT `queuePlugin`'s settings, though they sit next door. BullMQ
 * needs unbounded retries and an offline queue so a job is never lost to a
 * blip. A limiter is the opposite: it runs in front of every request, so an
 * unreachable Redis must produce an error in milliseconds. With the BullMQ
 * settings here, a Redis outage hangs every chat request instead of refusing
 * it -- which is worse than either failing open or failing closed.
 */
export const rateLimitPlugin = fp(async (app: FastifyInstance) => {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is not set');

  const redis = new IORedis(url, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 1000,
    commandTimeout: 1000,
    lazyConnect: true,
  });

  // Without a listener, a connection error on a background reconnect is an
  // unhandled 'error' event and takes the process down.
  redis.on('error', (error) => {
    app.log.error({ err: error }, 'rate limit redis error');
  });

  // With no offline queue a command issued before the socket is ready fails
  // immediately, so connect here rather than letting the first request race
  // the connection.
  try {
    await redis.connect();
  } catch (error) {
    throw new Error(`Cannot reach Redis for rate limiting at ${url}: ${String(error)}`);
  }

  app.decorate('rateLimitRedis', redis);
  app.addHook('onClose', async () => {
    redis.disconnect();
  });
});

const CHAT_MESSAGE = (after: string) => `Too many questions just now. Try again in ${after}.`;

/** Per visitor, per page: stops one person hammering one owner's page. */
export function chatPerPageLimit(redis: IORedis): RateLimitPluginOptions {
  return {
    ...FAIL_CLOSED,
    global: true,
    redis,
    nameSpace: namespace('chat-page:'),
    max: limit('RATE_LIMIT_CHAT_PER_PAGE', 30),
    timeWindow: '1 hour',
    // Lowercased to match how the page is looked up. Without it every casing
    // of the same handle is a separate budget for the same page.
    keyGenerator: (request) =>
      `${caller(request)}:${((request.params as { handle?: string }).handle ?? '-').toLowerCase()}`,
    errorResponseBuilder: tooMany(CHAT_MESSAGE),
  };
}

/** Per visitor, across every page: stops spraying where no one page fills up. */
export function chatPerIpLimit(redis: IORedis): RateLimitPluginOptions {
  return {
    ...FAIL_CLOSED,
    global: true,
    redis,
    nameSpace: namespace('chat-ip:'),
    max: limit('RATE_LIMIT_CHAT_PER_IP', 100),
    timeWindow: '1 hour',
    keyGenerator: caller,
    // The looser of the two dimensions, so its headers would otherwise
    // overwrite the tighter one's and tell a client it has budget it does not.
    addHeaders: { 'x-ratelimit-limit': false, 'x-ratelimit-remaining': false, 'x-ratelimit-reset': false },
    errorResponseBuilder: tooMany(CHAT_MESSAGE),
  };
}

/**
 * Per caller. An ingestion runs Opus over a whole site and costs roughly eight
 * times what an answer costs, so this budget is much tighter than chat's.
 */
export function ingestPerIpLimit(redis: IORedis): RateLimitPluginOptions {
  return {
    ...FAIL_CLOSED,
    global: true,
    redis,
    nameSpace: namespace('ingest-ip:'),
    max: limit('RATE_LIMIT_INGEST_PER_IP', 5),
    timeWindow: '1 hour',
    keyGenerator: caller,
    errorResponseBuilder: tooMany(
      (after) => `Too many ingestions started just now. Try again in ${after}.`,
    ),
  };
}

/**
 * Per page, whoever asks. A page's facts change when its owner edits their
 * site, not many times a day, so this caps what one page can cost even when
 * the requests come from many addresses.
 *
 * Runs at `preHandler` rather than the default `onRequest` because the page is
 * named in the body, and the body is not parsed until after `onRequest`. A
 * request rejected by schema validation therefore never reaches this limiter,
 * which is correct: a malformed body spends nothing.
 */
export function ingestPerPageLimit(redis: IORedis): RateLimitPluginOptions {
  return {
    ...FAIL_CLOSED,
    global: true,
    redis,
    hook: 'preHandler',
    nameSpace: namespace('ingest-page:'),
    max: limit('RATE_LIMIT_INGEST_PER_PAGE', 20),
    timeWindow: '1 day',
    // Keyed on the OWNER and the page, not the page alone.
    //
    // This limiter counts at preHandler, and ownership is checked in the
    // handler after it. Keyed on the page alone, any signed-in caller who
    // knew a page id could spend that page's whole daily budget and be told
    // 404 only afterwards -- locking the real owner out of their own page.
    // Including the account means a stranger can only ever exhaust their own
    // bucket. It costs the owner nothing, because a page has exactly one
    // owner and nobody else can complete an ingestion into it anyway.
    //
    // Falls back to the caller, never to a constant: a shared constant key
    // would put every request that reached here without a page into one
    // bucket and break the route for everyone once it filled.
    keyGenerator: (request) => {
      const pageId = (request.body as { pageId?: string } | undefined)?.pageId;
      const owner = request.account?.id ?? caller(request);
      return pageId ? `${owner}:${pageId}` : owner;
    },
    errorResponseBuilder: tooMany(
      (after) => `That page has been refreshed recently. Try again in ${after}.`,
    ),
  };
}

/**
 * Credential stuffing is the case this exists for: many addresses, one source.
 */
export function authPerIpLimit(redis: IORedis): RateLimitPluginOptions {
  return {
    ...FAIL_CLOSED,
    global: true,
    redis,
    nameSpace: namespace('auth-ip:'),
    max: limit('RATE_LIMIT_AUTH_PER_IP', 20),
    timeWindow: '15 minutes',
    keyGenerator: caller,
    errorResponseBuilder: tooMany((after) => `Too many attempts. Try again in ${after}.`),
  };
}

/**
 * One bucket per address PER ROUTE, not per address across all of them.
 *
 * Sharing one bucket lets an unauthenticated caller spend it: a dozen signup
 * posts for someone else's address would exhaust the budget that their login
 * needs, which is an account lockout anyone can trigger for free.
 *
 * The email is whatever the body carries, so it is only trusted to be a string
 * after validation has run. On a route with no body schema it will not be one,
 * and coercing it is how an unauthenticated 500 gets in.
 */
function perRouteEmailKey(request: FastifyRequest): string {
  const body = request.body as { email?: unknown } | undefined;
  const subject =
    typeof body?.email === 'string' ? body.email.toLowerCase() : caller(request);

  return `${request.routeOptions?.url ?? request.url}:${subject}`;
}

/**
 * And the other shape: one address, many sources. Runs at preHandler because
 * the address is in the body, which onRequest has not parsed yet.
 */
export function authPerEmailLimit(redis: IORedis): RateLimitPluginOptions {
  return {
    ...FAIL_CLOSED,
    global: true,
    redis,
    hook: 'preHandler',
    nameSpace: namespace('auth-email:'),
    max: limit('RATE_LIMIT_AUTH_PER_EMAIL', 10),
    timeWindow: '15 minutes',
    keyGenerator: perRouteEmailKey,
    errorResponseBuilder: tooMany((after) => `Too many attempts. Try again in ${after}.`),
  };
}
