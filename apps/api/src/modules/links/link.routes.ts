import type { FastifyBaseLogger, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { TILE_SIZES } from '@curios/core/bento';
import { PICTURE_MODES, PICTURE_PROVIDERS, WIDGET_PICTURE_MAX_BYTES } from '@curios/core/widgets';
import { UnauthenticatedError } from '../../plugins/session.js';
import { createHostGuard, type HostGuard } from '../ingest/host-guard.js';
import { resolveShortLink } from './widget-resolve.js';
import { fetchWidgetCard, type FetchWidgetCard } from './widget-card.js';
import { StorageNotConfiguredError } from '../pages/page.routes.js';
import { resolveStore, type AvatarStore } from '../pages/storage.js';
import { addLinkPicture, discardPictureFiles, ownWidget, InvalidPictureError, removeLinkPicture, reorderLinkPictures, type PictureDeps } from './link-picture.service.js';
import { addLink, addPictureWidget, addWidget, listLinks, removeLink, reorderLinks, updateLink } from './link.service.js';

// Payload bounds only. Every rule an owner can break is checked in the service,
// where it has a code and a sentence; a zod failure reaches them as INTERNAL_ERROR.
const params = z.object({ id: z.string().min(1).max(64) });
const label = z.string().max(400);
const url = z.string().max(2000);
const pictureParams = z.object({ id: z.string().min(1).max(64), pictureId: z.string().min(1).max(64) });

/** The raw body of a picture upload, whole, refused past 10 MB however long the sender said it was. */
async function pictureBody(request: FastifyRequest, gif: boolean): Promise<{ body: Buffer; contentType: string }> {
  const stream = request.body as AsyncIterable<Buffer> | undefined;
  // A JSON or form body was parsed by its own parser: not a picture.
  if (!stream || typeof (stream as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] !== 'function' || Buffer.isBuffer(stream)) throw new InvalidPictureError(gif);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.length;
    if (total > WIDGET_PICTURE_MAX_BYTES) throw new InvalidPictureError(gif);
    chunks.push(chunk);
  }
  const contentType = (request.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  return { body: Buffer.concat(chunks, total), contentType };
}

const isGifType = (request: FastifyRequest) => (request.headers['content-type'] ?? '').toLowerCase().startsWith('image/gif');

/** Refuses an oversize declared length before any byte is read. */
async function pictureLengthFits(request: FastifyRequest): Promise<void> {
  const length = Number(request.headers['content-length']);
  if (Number.isFinite(length) && length > WIDGET_PICTURE_MAX_BYTES) throw new InvalidPictureError(isGifType(request));
}

export interface LinkRouteOptions {
  /** Tests inject this; the real one fetches the short link through the host guard. */
  resolve?: (url: string) => Promise<string | null>;
  guard?: HostGuard;
  /** Tests inject this; the real one asks the service's own lookup for the card's title and cover. */
  card?: FetchWidgetCard;
  /** As PageRouteOptions.store: undefined builds from the environment, null is uploads off, tests pass a stub. */
  store?: AvatarStore | null;
}

export const linkRoutes: FastifyPluginAsyncZod<LinkRouteOptions> = async (app, options) => {
  const guard = options.guard ?? createHostGuard();
  const resolve = options.resolve ?? ((target: string) => resolveShortLink(target, { fetch, guard }));
  const store = resolveStore(options.store);
  const pictureDeps = (log: FastifyBaseLogger): PictureDeps => {
    if (!store) throw new StorageNotConfiguredError();
    return { prisma: app.prisma, store, log };
  };
  const card = options.card ?? ((provider, embedRef) => fetchWidgetCard(provider, embedRef, { fetch }));

  app.get('/links', async (request) => {
    if (!request.account) throw new UnauthenticatedError();
    return { links: await listLinks(app.prisma, request.account.id) };
  });

  app.post('/links', { schema: { body: z.object({ label, url }) } }, async (request, reply) => {
    if (!request.account) throw new UnauthenticatedError();
    const link = await addLink(app.prisma, request.account.id, request.body);
    return reply.status(201).send({ link });
  });

  app.post(
    '/links/widgets',
    { schema: { body: z.object({ url, label: label.nullable() }) } },
    async (request, reply) => {
      if (!request.account) throw new UnauthenticatedError();
      const link = await addWidget(app.prisma, request.account.id, request.body, resolve, card);
      return reply.status(201).send({ link });
    },
  );

  app.post(
    '/links/pictures',
    {
      schema: {
        body: z.object({
          provider: z.enum(PICTURE_PROVIDERS),
          mode: z.enum(PICTURE_MODES).optional(),
          label: label.nullable().optional(),
          altText: z.string().max(2000).nullable().optional(),
        }),
      },
    },
    async (request, reply) => {
      if (!request.account) throw new UnauthenticatedError();
      return reply.status(201).send({ link: await addPictureWidget(app.prisma, request.account.id, request.body) });
    },
  );

  app.put(
    '/links/:id/pictures/order',
    { schema: { params, body: z.object({ ids: z.array(z.string().min(1).max(64)).max(20) }) } },
    async (request) => {
      if (!request.account) throw new UnauthenticatedError();
      return { link: await reorderLinkPictures(pictureDeps(request.log), request.account.id, request.params.id, request.body.ids) };
    },
  );

  app.delete('/links/:id/pictures/:pictureId', { schema: { params: pictureParams } }, async (request) => {
    if (!request.account) throw new UnauthenticatedError();
    return { link: await removeLinkPicture(pictureDeps(request.log), request.account.id, request.params.id, request.params.pictureId) };
  });

  app.patch(
    '/links/:id',
    {
      schema: {
        params,
        body: z.object({
          label: label.optional(),
          url: url.optional(),
          size: z.enum(TILE_SIZES).nullable().optional(),
          pictureMode: z.enum(PICTURE_MODES).optional(),
          altText: z.string().max(2000).nullable().optional(),
        }),
      },
    },
    async (request) => {
      if (!request.account) throw new UnauthenticatedError();
      return { link: await updateLink(app.prisma, request.account.id, request.params.id, request.body, resolve, card) };
    },
  );

  app.delete('/links/:id', { schema: { params } }, async (request) => {
    if (!request.account) throw new UnauthenticatedError();
    const { pictureKeys } = await removeLink(app.prisma, request.account.id, request.params.id);
    if (store) await discardPictureFiles({ store, log: request.log }, pictureKeys);
    return { status: 'removed' };
  });

  app.put(
    '/links/order',
    { schema: { body: z.object({ ids: z.array(z.string().min(1).max(64)).max(200) }) } },
    async (request) => {
      if (!request.account) throw new UnauthenticatedError();
      await reorderLinks(app.prisma, request.account.id, request.body.ids);
      return { status: 'reordered' };
    },
  );
};

/**
 * The picture upload, in a plugin of its own so its parser, which passes the request stream through
 * unbuffered, reaches no other route, and so app.ts can give it a per-account limit.
 */
export const linkPictureUploadRoutes: FastifyPluginAsyncZod<Pick<LinkRouteOptions, 'store'>> = async (app, options) => {
  const store = resolveStore(options.store);
  app.addContentTypeParser('*', (_request, payload, done) => done(null, payload));
  app.post(
    '/links/:id/pictures',
    { bodyLimit: WIDGET_PICTURE_MAX_BYTES, onRequest: pictureLengthFits, schema: { params } },
    async (request, reply) => {
      if (!request.account) throw new UnauthenticatedError();
      if (!store) throw new StorageNotConfiguredError();
      // The widget is the owner's, and a picture widget, before a byte of the body is read: a wrong id costs nothing.
      await ownWidget(app.prisma, request.account.id, request.params.id);
      const picture = await pictureBody(request, isGifType(request));
      return reply.status(201).send({ link: await addLinkPicture({ prisma: app.prisma, store, log: request.log }, request.account.id, request.params.id, picture) });
    },
  );
};
