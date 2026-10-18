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
import { addItem, clearItemPhoto, listItems, removeItem, reorderItems, setItemPhoto, updateItem } from './item.service.js';
import { ItemNotFoundError } from './store.errors.js';
import { storePageFor } from './store-page.js';

export interface StoreRouteOptions {
  /** As PageRouteOptions.store: undefined builds from the environment, null is uploads off, tests pass a stub. */
  store?: AvatarStore | null;
}

// Payload bounds only; the service owns every rule with a sentence.
const text = z.string().max(2000);
const image = z.object({ contentType: z.string().max(40), data: z.string().max(1_500_000) });
const params = z.object({ id: z.string().min(1).max(64) });
const pricing = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('single'), priceCents: z.number() }),
  z.object({ kind: z.literal('options'), options: z.array(z.object({ label: z.string().max(400), priceCents: z.number() })).max(100) }),
]);

export const storeRoutes: FastifyPluginAsyncZod<StoreRouteOptions> = async (app, options) => {
  const store = resolveStore(options.store);

  app.get('/store', async (request) => {
    if (!request.account) throw new UnauthenticatedError();
    const settings = await getStoreSettings(app.prisma, request.account.id);
    return { settings, items: await listItems(app.prisma, request.account.id) };
  });

  app.patch(
    '/store/settings',
    {
      schema: {
        body: z.object({
          enabled: z.boolean().optional(),
          pickupEnabled: z.boolean().optional(),
          pickupNote: text.nullable().optional(),
          shopDescription: text.nullable().optional(),
          deliveryMode: z.enum(DELIVERY_MODES).optional(),
          deliveryFeeCents: z.number().int().nullable().optional(),
          minNoticeDays: z.number().int().optional(),
          closedDays: z.array(z.number()).max(20).optional(),
          deliveryNote: text.nullable().optional(),
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

  app.post('/store/items', { schema: { body: z.object({ name: text, description: text.nullable().optional(), pricing }) } }, async (request, reply) => {
    if (!request.account) throw new UnauthenticatedError();
    return reply.status(201).send({ item: await addItem(app.prisma, request.account.id, request.body) });
  });

  app.patch(
    '/store/items/:id',
    { schema: { params, body: z.object({ name: text.optional(), description: text.nullable().optional(), available: z.boolean().optional(), pricing: pricing.optional() }) } },
    async (request) => {
      if (!request.account) throw new UnauthenticatedError();
      return { item: await updateItem(app.prisma, request.account.id, request.params.id, request.body) };
    },
  );

  app.delete('/store/items/:id', { schema: { params } }, async (request) => {
    if (!request.account) throw new UnauthenticatedError();
    const photo = await removeItem(app.prisma, request.account.id, request.params.id);
    if (photo && store) {
      await store.remove(photo).catch((error: unknown) =>
        request.log.warn({ err: error instanceof Error ? error.message : String(error) }, 'removed item photo could not be deleted'),
      );
    }
    return { status: 'removed' };
  });

  app.put('/store/items/order', { schema: { body: z.object({ ids: z.array(z.string().min(1).max(64)).max(200) }) } }, async (request) => {
    if (!request.account) throw new UnauthenticatedError();
    await reorderItems(app.prisma, request.account.id, request.body.ids);
    return { status: 'reordered' };
  });

  app.post('/store/items/:id/photo', { bodyLimit: 2 * 1024 * 1024, schema: { params, body: image } }, async (request) => {
    if (!request.account) throw new UnauthenticatedError();
    const page = await storePageFor(app.prisma, request.account.id);
    if (!store) throw new StorageNotConfiguredError();
    const exists = await app.prisma.item.findFirst({ where: { id: request.params.id, pageId: page.id }, select: { id: true } });
    if (!exists) throw new ItemNotFoundError();
    const { body, ext } = decodeImage(request.body, AVATAR_MAX_BYTES);
    const key = `items/${page.id}/${randomUUID()}.${ext}`;
    await store.put(key, body, request.body.contentType);
    const old = await setItemPhoto(app.prisma, request.account.id, request.params.id, key);
    if (old) {
      await store.remove(old).catch((error: unknown) =>
        request.log.warn({ pageId: page.id, err: error instanceof Error ? error.message : String(error) }, 'old item photo could not be removed'),
      );
    }
    return { photoKey: key };
  });

  app.delete('/store/items/:id/photo', { schema: { params } }, async (request) => {
    if (!request.account) throw new UnauthenticatedError();
    const old = await clearItemPhoto(app.prisma, request.account.id, request.params.id);
    if (old && store) {
      await store.remove(old).catch((error: unknown) =>
        request.log.warn({ err: error instanceof Error ? error.message : String(error) }, 'removed item photo could not be deleted'),
      );
    }
    return { photoKey: null };
  });
};
