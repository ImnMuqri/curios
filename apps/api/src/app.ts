import { errorReportingHook } from '@curios/core/error-report';
import { reportError } from './lib/error-tracking.js';
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
import { settingsPlugin } from './plugins/settings.js';
import { requireSession, sessionPlugin } from './plugins/session.js';
import { adminSessionPlugin, requireAdmin } from './plugins/admin-session.js';
import {
  adminSigninRoutes,
  adminSessionRoutes,
} from './modules/admin/admin-auth.routes.js';
import { adminPagesRoutes, type AdminPagesRouteOptions } from './modules/admin/admin-pages.routes.js';
import { adminReportsRoutes } from './modules/admin/admin-reports.routes.js';
import { adminSettingsRoutes } from './modules/admin/admin-settings.routes.js';
import {
  adminSigninPerIpLimit,
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
  downloadPerIpLimit,
  receiptPerIpLimit,
  rateLimitPlugin,
  reportPerIpLimit,
  shopChipPerAccountLimit,
  shopPayMethodsPerIpLimit,
  shopPayPerIpLimit,
  shopPayPerOrderLimit,
  shopPayStatusPerOrderLimit,
} from './plugins/rate-limit.js';
import { ingestRoutes, type IngestRouteOptions } from './modules/ingest/ingest.routes.js';
import { chatRoutes, chatTestRoutes, type ChatRouteOptions } from './modules/chat/chat.routes.js';
import { leadRoutes, ownerLeadRoutes } from './modules/leads/lead.routes.js';
import { reportRoutes } from './modules/reports/report.routes.js';
import { nearPageRoutes, pageRoutes, type PageRouteOptions } from './modules/pages/page.routes.js';
import { storeRoutes } from './modules/store/store.routes.js';
import type { PrivateFiles } from './modules/store/private-files.js';
import { shopChipRoutes, type ShopChipRouteOptions } from './modules/store/chip.routes.js';
import { downloadRoutes } from './modules/orders/download.routes.js';
import { orderRoutes, ownerOrderRoutes, receiptRoutes, type OrderRouteOptions } from './modules/orders/order.routes.js';
import {
  createPayOnline,
  shopChipCallbackRoutes,
  shopPayMethodsRoutes,
  shopPayStartRoutes,
  shopPayStatusRoutes,
} from './modules/orders/pay-online.routes.js';
import { linkRoutes } from './modules/links/link.routes.js';
import { factRoutes, type FactRouteOptions } from './modules/facts/fact.routes.js';
import { sourceRecheckRoutes, sourceRoutes } from './modules/sources/source.routes.js';
import { neverSayRoutes } from './modules/never-say/never-say.routes.js';
import { topicRoutes } from './modules/topics/topic.routes.js';
import {
  chipRoutes,
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
  shopChip?: ShopChipRouteOptions;
  admin?: AdminPagesRouteOptions;
  /** Private storage for digital files; tests pass a disk one rooted in a temp dir. */
  privateFiles?: PrivateFiles | null;
}

/** `/store/orders/<token>/receipt` -> `/store/orders/:token/receipt`; any other URL is returned as it came. */
export function maskOrderToken(url: string): string {
  return url.replace(/^(\/store\/orders\/)[^/?#]+/, '$1:token');
}

export async function buildApp(overrides: AppOverrides = {}) {
  // Rate limits key off `request.ip`, which is the socket peer unless Fastify
  // is told to trust a proxy. Behind a load balancer or CDN every request
  // would otherwise carry the proxy's address, and the limiters would throttle
  // all visitors as though they were one caller. Off by default so local
  // development is unaffected and nothing can spoof its own address.
  const options: FastifyServerOptions = {
    logger: {
      // Every error-level line goes to error tracking as well, when it is on (lib/error-tracking.ts).
      hooks: { logMethod: errorReportingHook(reportError) },
      serializers: {
        // Fastify's own req serializer, but for the URL. An order link's token
        // is the order's only credential and it rides in the path, so every
        // /store/orders/<token>... URL is logged with the token masked.
        req: (request) => ({
          method: request.method,
          url: maskOrderToken(request.url),
          host: request.host,
          remoteAddress: request.ip,
          remotePort: request.socket ? request.socket.remotePort : undefined,
        }),
      },
    },
    trustProxy: resolveTrustProxy(),
  };
  const app = Fastify(options).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) throw new Error('SESSION_SECRET is not set');

  await app.register(cookie, { secret: sessionSecret });
  const appOrigin = process.env.APP_URL ?? 'http://localhost:3000';
  const adminOrigin = process.env.ADMIN_ORIGIN;
  // The admin app is allowed on /admin routes only, and only where ADMIN_ORIGIN is set; every
  // other route allows the owner app alone.
  await app.register(cors, {
    delegator: (request, callback) => {
      const onAdmin = Boolean(adminOrigin) && /^\/admin(?:[/?]|$)/.test(request.url);
      callback(null, { origin: onAdmin && adminOrigin ? [appOrigin, adminOrigin] : [appOrigin], credentials: true });
    },
  });
  await app.register(errorsPlugin);
  await app.register(prismaPlugin);
  // The admin's settings, which the owner-facing modules read too: decorated whether or not an admin origin is set.
  await app.register(settingsPlugin);
  // Paying shops online: built once, shared by checkout's routes, CHIP's callback and the
  // owner's cancel (which cancels CHIP's purchase first).
  const payOnline = createPayOnline(app.prisma, {
    chip: overrides.shopChip,
    store: overrides.orders?.store,
    mailQueue: () => overrides.orders?.mailQueue ?? app.mailQueue,
    payStatusEveryMs: overrides.orders?.payStatusEveryMs,
  });
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

  // A visitor reporting a page: anonymous, with its own per-IP budget (the chat
  // limiters would share a visitor's chat budget with it).
  await app.register(async (scope) => {
    await scope.register(rateLimit, reportPerIpLimit(app.rateLimitRedis));
    await scope.register(reportRoutes);
  });

  // A visitor's checkout: anonymous, so its own scope and its own two budgets.
  // Per-IP first, so one address's refused flood never reaches the per-shop
  // count and cannot spend a shop's daily budget on its own.
  await app.register(async (scope) => {
    await scope.register(rateLimit, orderPerIpLimit(app.rateLimitRedis));
    await scope.register(rateLimit, orderPerPageLimit(app.rateLimitRedis));
    await scope.register(orderRoutes, { ...(overrides.orders ?? {}), secretsKey: payOnline.secretsKey });
  });

  // The receipt on an order's link: anonymous too, with its own per-IP budget
  // (the shop budget above keys on a handle this path does not have).
  await app.register(async (scope) => {
    await scope.register(rateLimit, receiptPerIpLimit(app.rateLimitRedis));
    await scope.register(receiptRoutes, overrides.orders ?? {});
  });

  // What a buyer downloads or opens from their order: anonymous, the order link is the credential,
  // and its own per-IP budget (a download can stream 100 MB).
  await app.register(async (scope) => {
    await scope.register(rateLimit, downloadPerIpLimit(app.rateLimitRedis));
    await scope.register(downloadRoutes, { privateFiles: overrides.privateFiles });
  });

  // Paying a shop online through the owner's own CHIP account: anonymous, on the order
  // link. Asking what a shop takes has its own budget per visitor and shop; starting a
  // payment has its own per visitor and per order; the order page's check has its own,
  // larger budget per order, so a page left open never stops the visitor paying.
  await app.register(async (scope) => {
    await scope.register(rateLimit, shopPayMethodsPerIpLimit(app.rateLimitRedis));
    await scope.register(shopPayMethodsRoutes, { payOnline });
  });
  await app.register(async (scope) => {
    await scope.register(rateLimit, shopPayPerIpLimit(app.rateLimitRedis));
    await scope.register(rateLimit, shopPayPerOrderLimit(app.rateLimitRedis));
    await scope.register(shopPayStartRoutes, { payOnline });
  });
  await app.register(async (scope) => {
    await scope.register(rateLimit, shopPayStatusPerOrderLimit(app.rateLimitRedis));
    await scope.register(shopPayStatusRoutes, { payOnline });
  });

  // CHIP's callback for a shop's order. No session and no limit, as billing's callback
  // below: verified with that shop's own key, and a forged one costs a lookup to refuse.
  await app.register(shopChipCallbackRoutes, { payOnline });

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
    await scope.register(storeRoutes, { ...(overrides.pages ?? {}), privateFiles: overrides.privateFiles });
    await scope.register(ownerOrderRoutes, { ...(overrides.orders ?? {}), payOnline });
  });

  // The owner's own CHIP account. Signed in, and under its own per-account budget:
  // connecting tries a key against CHIP and starts a purchase, and the test starts one,
  // so neither may be repeated without limit. Session first, as in the billing scope below.
  await app.register(async (scope) => {
    scope.addHook('onRequest', requireSession);
    await scope.register(rateLimit, shopChipPerAccountLimit(app.rateLimitRedis));
    await scope.register(shopChipRoutes, overrides.shopChip ?? {});
  });

  // CHIP's return, and (with its callback and webhook) CHIP's own calls. No session --
  // CHIP has none -- and no per-IP limit: every genuine call comes from CHIP or from the
  // owner's own browser coming back, and a forged one costs one signature check or one
  // lookup to refuse. The plugin keeps its own body parsers, and its encapsulation keeps
  // them off every other route.
  await app.register(chipRoutes, overrides.billing ?? {});

  // Starting a payment. The session hook goes before the limiter, as in the ingest
  // scope, so an unauthenticated request is refused before it can spend any budget.
  await app.register(async (scope) => {
    scope.addHook('onRequest', requireSession);
    await scope.register(rateLimit, billingPerAccountLimit(app.rateLimitRedis));
    await scope.register(ownerBillingRoutes, overrides.billing ?? {});
  });

  // The Curios team's own sign-in, present only where an admin origin is configured.
  // Its own cookie and session: owner routes ignore it and these routes ignore the
  // owner's. Sign-in sits under the IP limiter and outside any session check.
  if (process.env.ADMIN_ORIGIN) {
    await app.register(adminSessionPlugin);
    await app.register(async (scope) => {
      await scope.register(rateLimit, adminSigninPerIpLimit(app.rateLimitRedis));
      await scope.register(adminSigninRoutes);
    });
    await app.register(adminSessionRoutes);
    await app.register(async (scope) => {
      scope.addHook('onRequest', requireAdmin);
      await scope.register(adminPagesRoutes, { ...(overrides.admin ?? {}), privateFiles: overrides.admin?.privateFiles ?? overrides.privateFiles });
      await scope.register(adminReportsRoutes, { mailQueue: overrides.admin?.mailQueue });
      await scope.register(adminSettingsRoutes);
    });
  }

  return app;
}
