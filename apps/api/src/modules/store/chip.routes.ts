import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { CHIP_DEFAULT_BASE_URL, createChipClient } from '@curios/billing';
import { paymentSecretsKey } from '@curios/core/secret-box';
import { UnauthenticatedError } from '../../plugins/session.js';
import { connectChip, disconnectChip, testChip, type ChipClientFor, type ShopChipDeps } from './chip.service.js';
import { ChipNotConfiguredError } from './store.errors.js';

export interface ShopChipRouteOptions {
  /** Injected only by tests; without it each owner's client is CHIP's own, at CHIP_BASE_URL. */
  clientFor?: ChipClientFor;
  /** As PAYMENT_SECRETS_KEY: undefined reads the environment, null is "not configured", tests pass a key. */
  secretsKey?: Buffer | null;
  /** Undefined reads NODE_ENV. */
  production?: boolean;
  /** Where CHIP calls back for a shop's order. Undefined reads CHIP_CALLBACK_BASE_URL; null leaves it out. */
  callbackBaseUrl?: string | null;
}

/**
 * PAYMENT_SECRETS_KEY, read once at registration so a missing or malformed key fails the
 * deploy rather than an owner's connect: production refuses to start without it, and
 * any value that is not the base64 of 32 bytes refuses to start everywhere. Null only
 * outside production, where connecting answers CHIP_NOT_CONFIGURED.
 */
export function resolveSecretsKey(options: ShopChipRouteOptions, production: boolean): Buffer | null {
  const key = options.secretsKey !== undefined ? options.secretsKey : paymentSecretsKey();
  if (!key && production) throw new Error('PAYMENT_SECRETS_KEY is not set');
  return key;
}

// Payload bounds only; the service owns the rules with a sentence.
const credentials = z.object({ brandId: z.string().max(200), secretKey: z.string().max(1000) });

/**
 * The owner's own CHIP account, in Store -> Payment. Registered behind the session. The
 * secret key arrives in one request body, is sealed, and is never sent back.
 */
export const shopChipRoutes: FastifyPluginAsyncZod<ShopChipRouteOptions> = async (app, options) => {
  const production = options.production ?? process.env.NODE_ENV === 'production';
  const secretsKey = resolveSecretsKey(options, production);
  if (!secretsKey) {
    app.log.warn('No PAYMENT_SECRETS_KEY: connecting CHIP in Store answers CHIP_NOT_CONFIGURED. Production refuses to start without it.');
  }
  const baseUrl = process.env.CHIP_BASE_URL || CHIP_DEFAULT_BASE_URL;
  const clientFor: ChipClientFor = options.clientFor ?? (({ secretKey, brandId }) => createChipClient({ secretKey, brandId, baseUrl }));
  const appUrl = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

  const deps = (log: ShopChipDeps['log']): ShopChipDeps => {
    if (!secretsKey) throw new ChipNotConfiguredError();
    return { prisma: app.prisma, clientFor, secretsKey, production, appUrl, log };
  };

  app.post('/store/chip', { schema: { body: credentials } }, async (request) => {
    if (!request.account) throw new UnauthenticatedError();
    return connectChip(deps(request.log), { accountId: request.account.id, ...request.body, now: new Date() });
  });

  app.delete('/store/chip', async (request) => {
    if (!request.account) throw new UnauthenticatedError();
    await disconnectChip(app.prisma, request.account.id, new Date());
    return { connected: false };
  });

  app.post('/store/chip/test', async (request) => {
    if (!request.account) throw new UnauthenticatedError();
    return testChip(deps(request.log), { accountId: request.account.id, now: new Date() });
  });
};
