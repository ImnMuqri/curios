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
  billingPerAccountLimit,
  chatTestPerAccountLimit,
  chatPerIpLimit,
  chatPerPageLimit,
  ingestPerIpLimit,
  ingestPerPageLimit,
  nearPerIpLimit,
  orderPerIpLimit,
  orderPerPageLimit,
  receiptPerIpLimit,
  rateLimitPlugin,
} from './plugins/rate-limit.js';
import { ingestRoutes, type IngestRouteOptions } from './modules/ingest/ingest.routes.js';
import { chatRoutes, chatTestRoutes, type ChatRouteOptions } from './modules/chat/chat.routes.js';
import { leadRoutes, ownerLeadRoutes } from './modules/leads/lead.routes.js';
import { nearPageRoutes, pageRoutes, type PageRouteOptions } from './modules/pages/page.routes.js';
import { storeRoutes } from './modules/store/store.routes.js';
import { orderRoutes, receiptRoutes, type OrderRouteOptions } from './modules/orders/order.routes.js';
import { linkRoutes } from './modules/links/link.routes.js';
import { factRoutes, type FactRouteOptions } from './modules/facts/fact.routes.js';
import { sourceRecheckRoutes, sourceRoutes } from './modules/sources/source.routes.js';
import { neverSayRoutes } from './modules/never-say/never-say.routes.js';
import { topicRoutes } from './modules/topics/topic.routes.js';
import {
  billplzRoutes,
  ownerBillingRoutes,
  type BillingRouteOptions,
} from './modules/billing/billing.routes.js';
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
  billing?: BillingRouteOptions;
  facts?: FactRouteOptions;
  pages?: PageRouteOptions;
  orders?: OrderRouteOptions;
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
    await scope.register(sourceRecheckRoutes);
  });

  await app.register(async (scope) => {
    await scope.register(rateLimit, chatPerPageLimit(app.rateLimitRedis));
    await scope.register(rateLimit, chatPerIpLimit(app.rateLimitRedis));
    await scope.register(chatRoutes, overrides.chat ?? {});
  });

  // The owner asking their own page, from Facts & sources. Signed in, so the
  // session hook goes first and the limit keys on the account, as billing's
  // does: the per-page and per-IP chat limits would share a visitor's budget.
  await app.register(async (scope) => {
    scope.addHook('onRequest', requireSession);
    await scope.register(rateLimit, chatTestPerAccountLimit(app.rateLimitRedis));
    await scope.register(chatTestRoutes, overrides.chat ?? {});
  });

  // Its own scope, with the per-IP limiter only. It cannot join the chat scope
  // above: chatPerPageLimit's key generator reads the `handle` route param,
  // which /leads does not have, so every request here would key on undefined
  // and share one bucket across every visitor on every page.
  await app.register(async (scope) => {
    await scope.register(rateLimit, chatPerIpLimit(app.rateLimitRedis));
    await scope.register(leadRoutes);
  });

  // A visitor's checkout: anonymous, so its own scope and its own two budgets.
  // Per-IP first, so one address's refused flood never reaches the per-shop
  // count and cannot spend a shop's daily budget on its own.
  await app.register(async (scope) => {
    await scope.register(rateLimit, orderPerIpLimit(app.rateLimitRedis));
    await scope.register(rateLimit, orderPerPageLimit(app.rateLimitRedis));
    await scope.register(orderRoutes, overrides.orders ?? {});
  });

  // The receipt on an order's link: anonymous too, with its own per-IP budget
  // (the shop budget above keys on a handle this path does not have).
  await app.register(async (scope) => {
    await scope.register(rateLimit, receiptPerIpLimit(app.rateLimitRedis));
    await scope.register(receiptRoutes, overrides.orders ?? {});
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

  // The 404's "Did you mean": public, so a per-IP budget of its own.
  await app.register(async (scope) => {
    await scope.register(rateLimit, nearPerIpLimit(app.rateLimitRedis));
    await scope.register(nearPageRoutes);
  });

  // Outside that scope on purpose: these two carry no credential to stuff, and
  // a session check is the most-called route the dashboard has.
  await app.register(sessionRoutes);

  await app.register(async (scope) => {
    scope.addHook('onRequest', requireSession);
    await scope.register(pageRoutes, overrides.pages ?? {});
    await scope.register(linkRoutes);
    await scope.register(factRoutes, overrides.facts ?? {});
    await scope.register(sourceRoutes);
    await scope.register(neverSayRoutes);
    await scope.register(topicRoutes);
    await scope.register(ownerLeadRoutes);
    await scope.register(storeRoutes, overrides.pages ?? {});
  });

  // Billplz's callback and redirect. No session -- Billplz has none -- and no per-IP
  // limit: every genuine retry comes from Billplz's own addresses, and a forged request
  // costs one HMAC to refuse. The plugin registers its own form parser, and its
  // encapsulation keeps that parser off every other route.
  await app.register(billplzRoutes, overrides.billing ?? {});

  // Starting a payment. The session hook goes before the limiter, as in the ingest
  // scope, so an unauthenticated request is refused before it can spend any budget.
  await app.register(async (scope) => {
    scope.addHook('onRequest', requireSession);
    await scope.register(rateLimit, billingPerAccountLimit(app.rateLimitRedis));
    await scope.register(ownerBillingRoutes, overrides.billing ?? {});
  });

  return app;
}
