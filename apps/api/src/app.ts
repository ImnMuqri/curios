import Fastify, { type FastifyServerOptions } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { errorsPlugin } from './plugins/errors.js';
import { prismaPlugin } from './plugins/prisma.js';
import { queuePlugin } from './plugins/queue.js';
import { requireSession, sessionPlugin } from './plugins/session.js';
import {
  authPerEmailLimit,
  authPerIpLimit,
  chatPerIpLimit,
  chatPerPageLimit,
  ingestPerIpLimit,
  ingestPerPageLimit,
  rateLimitPlugin,
} from './plugins/rate-limit.js';
import { ingestRoutes, type IngestRouteOptions } from './modules/ingest/ingest.routes.js';
import { chatRoutes, type ChatRouteOptions } from './modules/chat/chat.routes.js';
import { pageRoutes } from './modules/pages/page.routes.js';
import { factRoutes } from './modules/facts/fact.routes.js';
import {
  authFlowRoutes,
  authRoutes,
  sessionRoutes,
  type AuthRouteOptions,
} from './modules/auth/auth.routes.js';

/**
 * Blank or unset trusts nothing. `true` trusts whatever sits in front, which
 * is only safe when the app is unreachable except through that proxy;
 * otherwise give the proxy's address or subnet, comma separated, so a caller
 * cannot spoof `X-Forwarded-For` and hand itself a fresh rate-limit budget.
 */
function resolveTrustProxy(): FastifyServerOptions['trustProxy'] {
  const raw = process.env.TRUST_PROXY?.trim();
  if (!raw) return false;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return raw;
}

export interface AppOverrides {
  auth?: AuthRouteOptions;
  ingest?: IngestRouteOptions;
  chat?: ChatRouteOptions;
}

export async function buildApp(overrides: AppOverrides = {}) {
  // Rate limits key off `request.ip`, which is the socket peer unless Fastify
  // is told to trust a proxy. Behind a load balancer or CDN every request
  // would otherwise carry the proxy's address, and the limiters would throttle
  // all visitors as though they were one caller. Off by default so local
  // development is unaffected and nothing can spoof its own address.
  const options: FastifyServerOptions = { logger: true, trustProxy: resolveTrustProxy() };
  const app = Fastify(options).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) throw new Error('SESSION_SECRET is not set');

  await app.register(cookie, { secret: sessionSecret });
  await app.register(cors, {
    origin: process.env.APP_URL ?? 'http://localhost:3000',
    credentials: true,
  });
  await app.register(errorsPlugin);
  await app.register(prismaPlugin);
  await app.register(sessionPlugin);
  await app.register(queuePlugin);
  await app.register(rateLimitPlugin);

  // Outside the rate-limited scopes below, deliberately: a load balancer
  // polling this from one address would otherwise exhaust the per-IP budget
  // and take the API out of rotation for being healthy.
  app.get('/health', async () => ({ ok: true }));

  // The limiters are registered inside a scope holding only the routes they
  // guard. Fastify's encapsulation keeps them off every other route, so no
  // route needs to opt out and /health above cannot be throttled by accident.
  await app.register(async (scope) => {
    // Before the limiters, deliberately. Route-level preHandlers run after
    // instance-level hooks, so a per-route check would let the limiters count a
    // request that is about to be rejected as unauthenticated -- and the
    // per-page limiter keys on body.pageId, so anyone who learned a page id
    // could burn that owner's daily ingest budget without ever signing in.
    scope.addHook('onRequest', requireSession);
    await scope.register(rateLimit, ingestPerIpLimit(app.rateLimitRedis));
    await scope.register(rateLimit, ingestPerPageLimit(app.rateLimitRedis));
    await scope.register(ingestRoutes, overrides.ingest ?? {});
  });

  await app.register(async (scope) => {
    await scope.register(rateLimit, chatPerPageLimit(app.rateLimitRedis));
    await scope.register(rateLimit, chatPerIpLimit(app.rateLimitRedis));
    await scope.register(chatRoutes, overrides.chat ?? {});
  });

  // Both limiters, because every route in here carries an email address to
  // key the second one on.
  await app.register(async (scope) => {
    await scope.register(rateLimit, authPerIpLimit(app.rateLimitRedis));
    await scope.register(rateLimit, authPerEmailLimit(app.rateLimitRedis));
    await scope.register(authRoutes, overrides.auth ?? {});
  });

  // Per-IP only. These routes carry a one-time secret rather than an address,
  // so the per-email limiter would key on the caller's IP instead and halve
  // the budget it already has -- ten sign-in attempts for everyone behind one
  // NAT, which is a lockout rather than abuse protection.
  await app.register(async (scope) => {
    await scope.register(rateLimit, authPerIpLimit(app.rateLimitRedis));
    await scope.register(authFlowRoutes, overrides.auth ?? {});
  });

  // Outside that scope on purpose: these two carry no credential to stuff, and
  // a session check is the most-called route the dashboard has.
  await app.register(sessionRoutes);

  await app.register(async (scope) => {
    scope.addHook('onRequest', requireSession);
    await scope.register(pageRoutes);
    await scope.register(factRoutes);
  });

  return app;
}
