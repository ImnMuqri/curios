import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import IORedis from 'ioredis';
import type { RateLimitPluginOptions } from '@fastify/rate-limit';

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
 * spends Haiku tokens, and every `POST /ingest` spends Opus tokens. Without a
 * limit, an anonymous loop bills the owner without bound. This is a wallet
 * control, not a permission control, which is why it fails closed below.
 */
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
 * The rejection is thrown, not sent, so it lands in `errorsPlugin` and comes
 * out in the same `{ error: { code, message } }` envelope as every other error
 * this API returns. That plugin whitelists client-facing codes, so
 * `RATE_LIMITED` must stay listed there or a throttled visitor is told the
 * server broke instead of being asked to wait.
 */
function tooMany(message: string) {
  return () => ({ statusCode: 429, code: 'RATE_LIMITED', message });
}

/**
 * Opens the Redis connection the limiters share. Its own connection rather
 * than the queue's, matching how `queuePlugin` owns the one BullMQ uses.
 */
export const rateLimitPlugin = fp(async (app: FastifyInstance) => {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is not set');

  const redis = new IORedis(url, {
    // Deliberately NOT queuePlugin's settings, though they sit next door.
    // BullMQ requires `maxRetriesPerRequest: null` and an offline queue so a
    // job is never lost to a blip. A limiter is the opposite: it runs in front
    // of every request, so an unreachable Redis must produce an error in
    // milliseconds, not a command that waits forever. With the BullMQ settings
    // here, a Redis outage hangs every chat request instead of refusing it.
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 1000,
    commandTimeout: 1000,
    lazyConnect: true,
  });

  // Without a listener, a connection error on a background reconnect attempt
  // is an unhandled 'error' event and takes the process down.
  redis.on('error', (error) => {
    app.log.error({ err: error }, 'rate limit redis error');
  });

  // With no offline queue, a command issued before the socket is ready fails
  // immediately -- so connect here rather than letting the first request race
  // the connection. An unreachable Redis therefore stops the app booting,
  // which is the same fail-closed stance the request path takes.
  await redis.connect();

  app.decorate('rateLimitRedis', redis);
  app.addHook('onClose', async () => {
    redis.disconnect();
  });
});

/**
 * Per visitor IP, per page. The dimension that stops one person hammering
 * one owner's page.
 */
export function chatPerPageLimit(redis: IORedis): RateLimitPluginOptions {
  return {
    global: true,
    redis,
    // The plugin defaults to skipOnError: true -- letting requests through
    // when the store fails. That is the wrong default for a spending control:
    // a Redis outage is precisely when an unmetered paid endpoint is worth
    // abusing. Fail closed instead.
    skipOnError: false,
    nameSpace: namespace('chat-page:'),
    max: limit('RATE_LIMIT_CHAT_PER_PAGE', 30),
    timeWindow: '1 hour',
    keyGenerator: (request) =>
      `${request.ip}:${(request.params as { handle?: string }).handle ?? '-'}`,
    errorResponseBuilder: tooMany('Too many questions just now. Please wait a moment and try again.'),
  };
}

const INGEST_MESSAGE = 'That page has been refreshed recently. Try again a little later.';

/**
 * Per caller IP. An ingestion costs roughly eight times what an answer costs,
 * because it runs Opus over a whole crawled site, so this budget is much
 * tighter than the chat one.
 */
export function ingestPerIpLimit(redis: IORedis): RateLimitPluginOptions {
  return {
    global: true,
    redis,
    // The plugin defaults to skipOnError: true -- letting requests through
    // when the store fails. That is the wrong default for a spending control:
    // a Redis outage is precisely when an unmetered paid endpoint is worth
    // abusing. Fail closed instead.
    skipOnError: false,
    nameSpace: namespace('ingest-ip:'),
    max: limit('RATE_LIMIT_INGEST_PER_IP', 5),
    timeWindow: '1 hour',
    keyGenerator: (request) => request.ip,
    errorResponseBuilder: tooMany(INGEST_MESSAGE),
  };
}

/**
 * Per page, regardless of who asks. A page's facts change when its owner edits
 * their site, not many times a day, so this caps what any one page can cost
 * even if the requests arrive from many addresses.
 *
 * Runs at `preHandler` rather than the default `onRequest` because the page is
 * named in the body, and the body is not parsed until after `onRequest`. The
 * cost of running later is that a request rejected by schema validation never
 * reaches this limiter -- which is correct, since a malformed body spends
 * nothing.
 */
export function ingestPerPageLimit(redis: IORedis): RateLimitPluginOptions {
  return {
    global: true,
    redis,
    // The plugin defaults to skipOnError: true -- letting requests through
    // when the store fails. That is the wrong default for a spending control:
    // a Redis outage is precisely when an unmetered paid endpoint is worth
    // abusing. Fail closed instead.
    skipOnError: false,
    hook: 'preHandler',
    nameSpace: namespace('ingest-page:'),
    max: limit('RATE_LIMIT_INGEST_PER_PAGE', 20),
    timeWindow: '1 day',
    keyGenerator: (request) => (request.body as { pageId?: string } | undefined)?.pageId ?? '-',
    errorResponseBuilder: tooMany(INGEST_MESSAGE),
  };
}

/**
 * Per visitor IP, across every page. The dimension that stops one person
 * spraying many owners' pages, where no single page budget is ever exhausted.
 */
export function chatPerIpLimit(redis: IORedis): RateLimitPluginOptions {
  return {
    global: true,
    redis,
    // The plugin defaults to skipOnError: true -- letting requests through
    // when the store fails. That is the wrong default for a spending control:
    // a Redis outage is precisely when an unmetered paid endpoint is worth
    // abusing. Fail closed instead.
    skipOnError: false,
    nameSpace: namespace('chat-ip:'),
    max: limit('RATE_LIMIT_CHAT_PER_IP', 100),
    timeWindow: '1 hour',
    keyGenerator: (request) => request.ip,
    errorResponseBuilder: tooMany('Too many questions just now. Please wait a moment and try again.'),
  };
}
