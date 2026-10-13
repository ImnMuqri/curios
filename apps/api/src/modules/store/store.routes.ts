import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { TILE_SIZES } from '@curios/core/bento';
import { DELIVERY_MODES } from '@curios/core/store';
import { UnauthenticatedError } from '../../plugins/session.js';
import { AVATAR_MAX_BYTES, decodeImage } from '../pages/avatar.js';
import { StorageNotConfiguredError } from '../pages/page.routes.js';
import { resolveStore, type AvatarStore } from '../pages/storage.js';
import { clearPaymentQr, getStoreSettings, setPaymentQr, updateStoreSettings } from './settings.service.js';
import { storePageFor } from './store-page.js';

export interface StoreRouteOptions {
  /** As PageRouteOptions.store: undefined builds from the environment, null is uploads off, tests pass a stub. */
  store?: AvatarStore | null;
}

// Payload bounds only; the service owns every rule with a sentence.
const text = z.string().max(2000);
const image = z.object({ contentType: z.string().max(40), data: z.string().max(1_500_000) });

export const storeRoutes: FastifyPluginAsyncZod<StoreRouteOptions> = async (app, options) => {
  const store = resolveStore(options.store);

  app.get('/store', async (request) => {
    if (!request.account) throw new UnauthenticatedError();
    const settings = await getStoreSettings(app.prisma, request.account.id);
    return { settings, items: [] as unknown[] }; // Task 4 replaces the empty list with listItems
  });

  app.patch(
    '/store/settings',
    {
      schema: {
        body: z.object({
          enabled: z.boolean().optional(),
          pickupEnabled: z.boolean().optional(),
          pickupNote: text.nullable().optional(),
          deliveryMode: z.enum(DELIVERY_MODES).optional(),
          deliveryFeeCents: z.number().int().nullable().optional(),
          minNoticeDays: z.number().int().optional(),
          bankName: text.nullable().optional(),
          bankAccountName: text.nullable().optional(),
          bankAccountNumber: text.nullable().optional(),
          tileSize: z.enum(TILE_SIZES).nullable().optional(),
        }),
      },
    },
    async (request) => {
      if (!request.account) throw new UnauthenticatedError();
      return { settings: await updateStoreSettings(app.prisma, request.account.id, request.body) };
    },
  );

  app.post('/store/payment-qr', { bodyLimit: 2 * 1024 * 1024, schema: { body: image } }, async (request) => {
    if (!request.account) throw new UnauthenticatedError();
    const page = await storePageFor(app.prisma, request.account.id);
    if (!store) throw new StorageNotConfiguredError();
    const { body, ext } = decodeImage(request.body, AVATAR_MAX_BYTES);
    // Random, so a replaced QR is never served from a stale cache.
    const key = `qr/${page.id}/${randomUUID()}.${ext}`;
    await store.put(key, body, request.body.contentType);
    const old = await setPaymentQr(app.prisma, page.id, key);
    if (old) {
      await store.remove(old).catch((error: unknown) =>
        request.log.warn({ pageId: page.id, err: error instanceof Error ? error.message : String(error) }, 'old payment QR could not be removed'),
      );
    }
    return { paymentQrKey: key };
  });

  app.delete('/store/payment-qr', async (request) => {
    if (!request.account) throw new UnauthenticatedError();
    const page = await storePageFor(app.prisma, request.account.id);
    const old = await clearPaymentQr(app.prisma, page.id);
    if (old && store) {
      await store.remove(old).catch((error: unknown) =>
        request.log.warn({ pageId: page.id, err: error instanceof Error ? error.message : String(error) }, 'removed payment QR could not be deleted'),
      );
    }
    return { paymentQrKey: null };
  });
};
