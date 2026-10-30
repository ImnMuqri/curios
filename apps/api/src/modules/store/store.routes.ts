import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { TILE_SIZES } from '@curios/core/bento';
import { MAX_DIGITAL_FILE_BYTES } from '@curios/core/digital';
import { DELIVERY_MODES } from '@curios/core/store';
import { UnauthenticatedError } from '../../plugins/session.js';
import { AVATAR_MAX_BYTES, decodeImage } from '../pages/avatar.js';
import { StorageNotConfiguredError } from '../pages/page.routes.js';
import { resolveStore, type AvatarStore } from '../pages/storage.js';
import { clearPaymentQr, getStoreSettings, setPaymentQr, updateStoreSettings } from './settings.service.js';
import { redrawDuitNowQr, REDRAWN_PREFIX } from './payment-qr.js';
import { addItem, clearItemPhoto, listItems, removeItem, reorderItems, setItemPhoto, updateItem } from './item.service.js';
import {
  addCodes,
  addSession,
  allowedFileType,
  assertFileType,
  checkFileRoom,
  cleanFileName,
  declaredLength,
  limitBytes,
  newFileKey,
  recordFile,
  removeCode,
  removeFile,
  removeSession,
  removeStored,
  updateSession,
} from './digital-item.service.js';
import { FileTooBigError, InvalidFileError, ItemNotFoundError } from './store.errors.js';
import { resolvePrivateFiles, type PrivateFiles } from './private-files.js';
import { storePageFor } from './store-page.js';
import { addVoucher, listVouchers, removeVoucher, updateVoucher } from './voucher.service.js';

export interface StoreRouteOptions {
  /** As PageRouteOptions.store: undefined builds from the environment, null is uploads off, tests pass a stub. */
  store?: AvatarStore | null;
  /** Private storage for digital files: undefined builds from the environment, null is off, tests pass a disk one. */
  privateFiles?: PrivateFiles | null;
}

// Payload bounds only; the service owns every rule with a sentence.
const text = z.string().max(2000);
const image = z.object({ contentType: z.string().max(40), data: z.string().max(1_500_000) });
const params = z.object({ id: z.string().min(1).max(64) });
const fileParams = z.object({ id: z.string().min(1).max(64), fileId: z.string().min(1).max(64) });
const codeParams = z.object({ id: z.string().min(1).max(64), codeId: z.string().min(1).max(64) });
const sessionParams = z.object({ id: z.string().min(1).max(64), sessionId: z.string().min(1).max(64) });
// Payload bounds only; digital-item.service owns the rules with a sentence.
const digital = {
  kind: z.enum(['PHYSICAL', 'DIGITAL']).optional(),
  delivery: z.enum(['FILES', 'LINK', 'CODES', 'SESSION']).nullable().optional(),
  accessUrl: z.string().max(4000).nullable().optional(),
  accessNote: z.string().max(2000).nullable().optional(),
  sessionMinutes: z.number().nullable().optional(),
  sessionPlace: z.enum(['ONLINE', 'IN_PERSON']).nullable().optional(),
  sessionWhere: z.string().max(2000).nullable().optional(),
};
const sessionStart = z.string().max(40).transform((value, ctx) => {
  const date = new Date(value);
  if (!/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/i.test(value) || Number.isNaN(date.getTime())) {
    ctx.addIssue({ code: 'custom', message: 'Pick a date and time.' });
    return z.NEVER;
  }
  return date;
});
const pricing = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('single'), priceCents: z.number() }),
  z.object({ kind: z.literal('options'), options: z.array(z.object({ label: z.string().max(400), priceCents: z.number() })).max(100) }),
]);

// Payload bounds only; checkVoucherInput owns every rule with a sentence.
const voucherFields = {
  mode: z.enum(['AUTO', 'CODE']),
  code: z.string().max(100).nullable(),
  name: z.string().max(200).nullable(),
  kind: z.enum(['PERCENT', 'AMOUNT']),
  percent: z.number().nullable(),
  amountCents: z.number().nullable(),
  itemId: z.string().min(1).max(64).nullable(),
  minSpendCents: z.number().nullable(),
  endsOn: z.string().max(10).nullable(),
  maxUses: z.number().nullable(),
};

export const storeRoutes:FastifyPluginAsyncZod<StoreRouteOptions> = async (app, options) => {
  const store = resolveStore(options.store);
  // Resolved at registration, like `store`: production with a missing setting fails the deploy, not an owner's upload.
  const privateFiles = resolvePrivateFiles(options.privateFiles);

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
          shopHalal: z.boolean().optional(),
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
    const { body } = decodeImage(request.body, AVATAR_MAX_BYTES);
    // What is kept is not the picture but the QR read out of it, redrawn in DuitNow pink
    // (payment-qr.ts); a picture with no DuitNow QR to read is refused here, before storage.
    const qr = await redrawDuitNowQr(body);
    // Random, so a replaced QR is never served from a stale cache.
    const key = `qr/${page.id}/${REDRAWN_PREFIX}${randomUUID()}.png`;
    await store.put(key, qr, 'image/png');
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

  app.post('/store/items', { schema: { body: z.object({ name: text, description: text.nullable().optional(), category: text.nullable().optional(), tag: text.nullable().optional(), pricing, ...digital }) } }, async (request, reply) => {
    if (!request.account) throw new UnauthenticatedError();
    return reply.status(201).send({ item: await addItem(app.prisma, request.account.id, request.body) });
  });

  app.patch(
    '/store/items/:id',
    { schema: { params, body: z.object({ name: text.optional(), description: text.nullable().optional(), category: text.nullable().optional(), tag: text.nullable().optional(), available: z.boolean().optional(), pricing: pricing.optional(), ...digital }) } },
    async (request) => {
      if (!request.account) throw new UnauthenticatedError();
      return { item: await updateItem(app.prisma, request.account.id, request.params.id, request.body) };
    },
  );

  app.delete('/store/items/:id', { schema: { params } }, async (request) => {
    if (!request.account) throw new UnauthenticatedError();
    const { photoKey: photo, fileKeys } = await removeItem(app.prisma, request.account.id, request.params.id);
    if (privateFiles) {
      for (const key of fileKeys) await removeStored(privateFiles, key, (err) => request.log.warn({ err }, 'removed item file could not be deleted'));
    }
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

  app.get('/store/vouchers', async (request) => {
    if (!request.account) throw new UnauthenticatedError();
    return { vouchers: await listVouchers(app.prisma, request.account.id) };
  });

  app.post('/store/vouchers', { schema: { body: z.object(voucherFields) } }, async (request, reply) => {
    if (!request.account) throw new UnauthenticatedError();
    return reply.status(201).send({ voucher: await addVoucher(app.prisma, request.account.id, request.body) });
  });

  app.patch(
    '/store/vouchers/:id',
    { schema: { params, body: z.object(voucherFields).partial().extend({ active: z.boolean().optional() }) } },
    async (request) => {
      if (!request.account) throw new UnauthenticatedError();
      return { voucher: await updateVoucher(app.prisma, request.account.id, request.params.id, request.body) };
    },
  );

  app.delete('/store/vouchers/:id', { schema: { params } }, async (request, reply) => {
    if (!request.account) throw new UnauthenticatedError();
    await removeVoucher(app.prisma, request.account.id, request.params.id);
    return reply.status(204).send();
  });

  // Digital items. The upload gets its own plugin scope so its parser, which passes the
  // request stream through unbuffered, reaches no other route.
  const uploadRoutes: FastifyPluginAsyncZod = async (upload) => {
    upload.addContentTypeParser('*', (_request, payload, done) => done(null, payload));

    upload.post(
      '/store/items/:id/files',
      {
        bodyLimit: MAX_DIGITAL_FILE_BYTES,
        schema: { params },
        // Before any byte is read: a wrong type or an oversize length costs nothing.
        onRequest: async (request) => {
          assertFileType(request.headers['content-type'], request.headers['x-file-name'] as string | undefined);
          declaredLength(request.headers['content-length']);
        },
      },
      async (request, reply) => {
        if (!request.account) throw new UnauthenticatedError();
        if (!privateFiles) throw new StorageNotConfiguredError();
        const contentType = allowedFileType(request.headers['content-type'], request.headers['x-file-name'] as string | undefined);
        if (!contentType) throw new InvalidFileError('Files can be a PDF, image, ZIP, audio or video.');
        const name = cleanFileName(request.headers['x-file-name']);
        const length = declaredLength(request.headers['content-length']);
        const itemId = request.params.id;
        const { pageId } = await checkFileRoom(app.prisma, request.account.id, itemId);

        const key = newFileKey(pageId, itemId);
        // Counts what really arrives, so a lying content-length still stops at the limit.
        const counted = limitBytes(MAX_DIGITAL_FILE_BYTES);
        const body = request.body as Readable;
        body.on('error', (error) => counted.destroy(error));
        body.pipe(counted);
        try {
          await privateFiles.put(key, counted, contentType, length);
          if (counted.bytes !== length) throw new InvalidFileError('The file did not arrive whole. Try again.');
          const file = await recordFile(app.prisma, request.account.id, itemId, { key, name, sizeBytes: length, contentType });
          return await reply.status(201).send(file);
        } catch (error) {
          // A failed upload leaves nothing: the object, or whatever part of it there is.
          await removeStored(privateFiles, key, (err) => request.log.warn({ err }, 'abandoned upload could not be removed'));
          if (counted.errored instanceof FileTooBigError) throw counted.errored;
          throw error;
        }
      },
    );
  };
  await app.register(uploadRoutes);

  app.delete('/store/items/:id/files/:fileId', { schema: { params: fileParams } }, async (request) => {
    if (!request.account) throw new UnauthenticatedError();
    const key = await removeFile(app.prisma, request.account.id, request.params.id, request.params.fileId);
    if (privateFiles) await removeStored(privateFiles, key, (err) => request.log.warn({ err }, 'removed item file could not be deleted'));
    return { status: 'removed' };
  });

  app.put('/store/items/:id/codes', { schema: { params, body: z.object({ text: z.string().max(500_000) }) } }, async (request) => {
    if (!request.account) throw new UnauthenticatedError();
    return addCodes(app.prisma, request.account.id, request.params.id, request.body.text);
  });

  app.delete('/store/items/:id/codes/:codeId', { schema: { params: codeParams } }, async (request) => {
    if (!request.account) throw new UnauthenticatedError();
    return { status: 'removed', ...(await removeCode(app.prisma, request.account.id, request.params.id, request.params.codeId)) };
  });

  app.post('/store/items/:id/sessions', { schema: { params, body: z.object({ startsAt: sessionStart, seats: z.number() }) } }, async (request, reply) => {
    if (!request.account) throw new UnauthenticatedError();
    return reply.status(201).send({ session: await addSession(app.prisma, request.account.id, request.params.id, request.body) });
  });

  app.patch(
    '/store/items/:id/sessions/:sessionId',
    { schema: { params: sessionParams, body: z.object({ startsAt: sessionStart.optional(), seats: z.number().optional() }) } },
    async (request) => {
      if (!request.account) throw new UnauthenticatedError();
      return { session: await updateSession(app.prisma, request.account.id, request.params.id, request.params.sessionId, request.body) };
    },
  );

  app.delete('/store/items/:id/sessions/:sessionId', { schema: { params: sessionParams } }, async (request) => {
    if (!request.account) throw new UnauthenticatedError();
    await removeSession(app.prisma, request.account.id, request.params.id, request.params.sessionId);
    return { status: 'removed' };
  });
};
