import { randomUUID } from 'node:crypto';
import { SOCIAL_KINDS, type SocialKind } from '@curios/core/socials';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { HEADING_FONTS, PAGE_BACKGROUNDS, PAGE_STYLES, STOCK_COVERS, stockCoverKey, stockCoverName } from '@curios/core/bento';
import { UnauthenticatedError } from '../../plugins/session.js';
import { updateAppearance } from './appearance.service.js';
import { COVER_MAX_BYTES, decodeAvatar, decodeImage } from './avatar.js';
import { claimHandle, handleAvailability, nearestPage, NoPageError, publishPage, setNotifications, setSearchIndexing, upgradeToBusiness } from './page.service.js';
import { resolveStore, type AvatarStore } from './storage.js';

export interface PageRouteOptions {
  /**
   * `undefined` builds a store from the environment (or none, in development
   * with no storage settings). `null` means uploads are off. Tests pass a stub.
   */
  store?: AvatarStore | null;
}

export class StorageNotConfiguredError extends Error {
  readonly statusCode = 503;
  readonly code = 'STORAGE_NOT_CONFIGURED';
  constructor() {
    super('Pictures are switched off here: no storage settings in this environment.');
    this.name = 'StorageNotConfiguredError';
  }
}

/**
 * The 404's "Did you mean": the published page a mistyped address was
 * probably meant to be. No session -- a visitor who mistyped has none -- and
 * its own per-IP limit (app.ts). It names only pages that are public anyway.
 */
export const nearPageRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/pages/near',
    { schema: { querystring: z.object({ handle: z.string().max(200) }) } },
    async (request, reply) => reply.send({ handle: await nearestPage(app.prisma, request.query.handle) }),
  );
};

export const pageRoutes: FastifyPluginAsyncZod<PageRouteOptions> = async (app, options) => {
  // Resolved at registration, like chat's embedder: production with a missing
  // setting fails the deploy, not an owner's upload.
  const store = resolveStore(options.store);

  app.post(
    '/pages',
    {
      schema: {
        body: z.object({
          // Deliberately NOT HANDLE_MIN/HANDLE_MAX. Schema validation runs
          // before the handler, so bounding the handle here means a too-short
          // handle never reaches `checkHandle` and comes back as a Fastify
          // validation error -- which `errorsPlugin` does not whitelist, so the
          // caller is told INTERNAL_ERROR for typing two characters.
          //
          // The 200 is an abuse bound on the payload, nothing more. Every real
          // decision about what a handle may be belongs to `checkHandle`, which
          // has a code and a message that say what the rule is.
          handle: z.string().min(1).max(200),
          displayName: z.string().min(1).max(80),
          // Optional so existing callers keep working; absent means BUSINESS,
          // the column's own default.
          mode: z.enum(['PERSONAL', 'BUSINESS']).optional(),
        }),
      },
    },
    async (request, reply) => {
      // Required on the scope in app.ts. Narrowed rather than asserted, so a
      // non-null assertion cannot outlive someone moving that hook.
      if (!request.account) throw new UnauthenticatedError();

      const result = await claimHandle(app.prisma, request.account.id, request.body);
      return reply.status(201).send(result);
    },
  );

  // Onboarding's live check while an owner types an address. Signed in, like
  // the claim it previews; what it reveals (that a page exists at an
  // address) is what visiting the address reveals anyway.
  app.get(
    '/pages/handle-check',
    { schema: { querystring: z.object({ handle: z.string().max(200) }) } },
    async (request, reply) => {
      if (!request.account) throw new UnauthenticatedError();
      return reply.send({ status: await handleAvailability(app.prisma, request.query.handle) });
    },
  );

  app.post('/publish', async (request, reply) => {
    if (!request.account) throw new UnauthenticatedError();

    await publishPage(app.prisma, request.account.id);
    return reply.send({ status: 'published' });
  });

  app.post('/pages/upgrade', async (request, reply) => {
    if (!request.account) throw new UnauthenticatedError();

    await upgradeToBusiness(app.prisma, request.account.id);
    return reply.send({ status: 'business' });
  });

  app.patch(
    '/pages/search-indexing',
    { schema: { body: z.object({ allow: z.boolean() }) } },
    async (request, reply) => {
      if (!request.account) throw new UnauthenticatedError();

      await setSearchIndexing(app.prisma, request.account.id, request.body.allow);
      return reply.send({ allowSearchIndexing: request.body.allow });
    },
  );

  app.patch(
    '/pages/notifications',
    {
      schema: {
        // Each switch on its own, so a tap on one never rewrites another; at least one.
        body: z
          .object({ leads: z.boolean().optional(), orders: z.boolean().optional(), receipts: z.boolean().optional() })
          .strict()
          .refine((body) => Object.keys(body).length > 0, { message: 'Say which email to switch.' }),
      },
    },
    async (request, reply) => {
      if (!request.account) throw new UnauthenticatedError();

      await setNotifications(app.prisma, request.account.id, request.body);
      return reply.send(request.body);
    },
  );

  app.patch(
    '/pages/appearance',
    {
      schema: {
        body: z.object({
          style: z.enum(PAGE_STYLES).optional(),
          background: z.enum(PAGE_BACKGROUNDS).optional(),
          backgroundColor: z.string().max(32).optional(),
          accentColor: z.string().max(40).optional(),
          headingFont: z.enum(HEADING_FONTS).optional(),
          displayName: z.string().max(400).optional(),
          bio: z.string().max(2000).nullable().optional(),
          // Strict, so a kind this does not know is refused rather than stored.
          socials: z
            .object(Object.fromEntries(SOCIAL_KINDS.map((kind) => [kind, z.string().max(300).optional()])) as Record<SocialKind, z.ZodOptional<z.ZodString>>)
            .strict()
            .optional(),
        }),
      },
    },
    async (request) => {
      if (!request.account) throw new UnauthenticatedError();
      return { appearance: await updateAppearance(app.prisma, request.account.id, request.body) };
    },
  );

  app.post(
    '/pages/avatar',
    {
      // A 512px WebP is ~40 KB; base64 adds a third. 2 MB is the ceiling of
      // AVATAR_MAX_BYTES encoded, with room for the JSON around it.
      bodyLimit: 2 * 1024 * 1024,
      schema: { body: z.object({ contentType: z.string().max(40), data: z.string().max(1_500_000) }) },
    },
    async (request) => {
      if (!request.account) throw new UnauthenticatedError();
      if (!store) throw new StorageNotConfiguredError();
      const { body, ext } = decodeAvatar(request.body);

      const page = await app.prisma.page.findUnique({ where: { accountId: request.account.id }, select: { id: true, avatarKey: true } });
      if (!page) throw new NoPageError();

      // Random, so a replaced picture is never served from a stale cache.
      const key = `avatars/${page.id}/${randomUUID()}.${ext}`;
      await store.put(key, body, request.body.contentType);
      await app.prisma.page.update({ where: { id: page.id }, data: { avatarKey: key } });

      // After the new key is recorded, never before: a failure here leaves an
      // orphaned object, not a page pointing at nothing.
      if (page.avatarKey) {
        await store.remove(page.avatarKey).catch((error: unknown) =>
          request.log.warn({ pageId: page.id, err: error instanceof Error ? error.message : String(error) }, 'old avatar could not be removed'),
        );
      }
      return { avatarKey: key };
    },
  );

  app.delete('/pages/avatar', async (request) => {
    if (!request.account) throw new UnauthenticatedError();
    if (!store) throw new StorageNotConfiguredError();
    const page = await app.prisma.page.findUnique({ where: { accountId: request.account.id }, select: { id: true, avatarKey: true } });
    if (!page) throw new NoPageError();

    await app.prisma.page.update({ where: { id: page.id }, data: { avatarKey: null } });
    if (page.avatarKey) {
      await store.remove(page.avatarKey).catch((error: unknown) =>
        request.log.warn({ pageId: page.id, err: error instanceof Error ? error.message : String(error) }, 'removed avatar object could not be deleted'),
      );
    }
    return { status: 'removed' };
  });

  // ---- The cover photo: an upload, a stock cover, or none ----

  /**
   * The page's current cover, and a way to let go of the old one once the new
   * one is recorded. Only an uploaded cover is an object in storage; a stock
   * cover ships with the web app and is never removed.
   */
  async function coverOf(accountId: string) {
    const page = await app.prisma.page.findUnique({ where: { accountId }, select: { id: true, coverKey: true } });
    if (!page) throw new NoPageError();
    return page;
  }

  function releaseCover(pageId: string, key: string | null, log: { warn: (o: object, m: string) => void }) {
    if (!key || stockCoverName(key) || !store) return;
    void store.remove(key).catch((error: unknown) =>
      log.warn({ pageId, err: error instanceof Error ? error.message : String(error) }, 'old cover could not be removed'),
    );
  }

  app.post(
    '/pages/cover',
    {
      // COVER_MAX_BYTES (2 MB) base64-encoded is ~2.8 MB, with room for the JSON around it.
      bodyLimit: 3 * 1024 * 1024 + 512 * 1024,
      schema: { body: z.object({ contentType: z.string().max(40), data: z.string().max(2_900_000) }) },
    },
    async (request) => {
      if (!request.account) throw new UnauthenticatedError();
      if (!store) throw new StorageNotConfiguredError();
      const { body, ext } = decodeImage(request.body, COVER_MAX_BYTES);
      const page = await coverOf(request.account.id);

      // Random, so a replaced cover is never served from a stale cache.
      const key = `covers/${page.id}/${randomUUID()}.${ext}`;
      await store.put(key, body, request.body.contentType);
      await app.prisma.page.update({ where: { id: page.id }, data: { coverKey: key } });
      // After the new key is recorded, never before: a failure leaves an orphaned object, not a page pointing at nothing.
      releaseCover(page.id, page.coverKey, request.log);
      return { coverKey: key };
    },
  );

  // A stock cover needs no storage, so it works where uploads are switched off.
  app.put(
    '/pages/cover/stock',
    { schema: { body: z.object({ name: z.enum(STOCK_COVERS) }) } },
    async (request) => {
      if (!request.account) throw new UnauthenticatedError();
      const page = await coverOf(request.account.id);
      const key = stockCoverKey(request.body.name);
      await app.prisma.page.update({ where: { id: page.id }, data: { coverKey: key } });
      releaseCover(page.id, page.coverKey, request.log);
      return { coverKey: key };
    },
  );

  app.delete('/pages/cover', async (request) => {
    if (!request.account) throw new UnauthenticatedError();
    const page = await coverOf(request.account.id);
    await app.prisma.page.update({ where: { id: page.id }, data: { coverKey: null } });
    releaseCover(page.id, page.coverKey, request.log);
    return { status: 'removed' };
  });
};
