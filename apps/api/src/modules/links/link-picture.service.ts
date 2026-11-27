import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@curios/db';
import { isPictureProvider, picturesAllowed, WIDGET_PICTURE_EDGE, WIDGET_PICTURE_MAX_BYTES } from '@curios/core/widgets';
import { prepareWidgetPicture } from '../../lib/item-photo-image.js';
import type { AvatarStore } from '../pages/storage.js';
import { LINK_SELECT, LinkNotFoundError, type LinkRow } from './link.service.js';
import { NoPageError } from '../pages/page.service.js';

export class InvalidPictureError extends Error {
  readonly statusCode = 400;
  readonly code = 'INVALID_PICTURE';
  constructor(gif: boolean) {
    super(gif ? 'Use a GIF, up to 10 MB.' : 'Use a JPEG, PNG or WebP picture, up to 10 MB.');
    this.name = 'InvalidPictureError';
  }
}

export class PictureLimitError extends Error {
  readonly statusCode = 409;
  readonly code = 'PICTURE_LIMIT';
  constructor(max: number) {
    super(max === 1 ? 'A GIF widget holds one GIF. Remove it to add another.' : `A Pictures widget holds up to ${max} pictures.`);
    this.name = 'PictureLimitError';
  }
}

export class PictureNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'PICTURE_NOT_FOUND';
  constructor() {
    super('No such picture.');
    this.name = 'PictureNotFoundError';
  }
}

/** Another tab changed the pictures after this one loaded them. */
export class PictureOrderStaleError extends Error {
  readonly statusCode = 409;
  readonly code = 'PICTURE_ORDER_STALE';
  constructor() {
    super('The pictures changed somewhere else. Reload to see the latest, then try again.');
    this.name = 'PictureOrderStaleError';
  }
}

export type PictureDeps = {
  prisma: PrismaClient;
  /** Public: the pictures and GIFs. */
  store: AvatarStore;
  log: { warn: (o: object, msg: string) => void };
};

type Tx = Prisma.TransactionClient;

/** The owner's picture widget, checked before any picture work or upload: another owner's put nothing. */
export async function ownWidget(prisma: PrismaClient, accountId: string, linkId: string): Promise<{ pageId: string; gif: boolean }> {
  const page = await prisma.page.findUnique({ where: { accountId }, select: { id: true } });
  if (!page) throw new NoPageError();
  const link = await prisma.link.findFirst({ where: { id: linkId, pageId: page.id, kind: 'WIDGET' }, select: { provider: true } });
  if (!link || !isPictureProvider(link.provider)) throw new LinkNotFoundError();
  return { pageId: page.id, gif: link.provider === 'GIF' };
}

/** The widget's row lock: every picture write on one widget waits its turn, so a count read under it holds until commit. */
async function lockWidget(tx: Tx, linkId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Link" WHERE "id" = ${linkId} FOR UPDATE`;
  if (rows.length === 0) throw new LinkNotFoundError();
}

const resultOf = (tx: Tx, linkId: string): Promise<LinkRow> => tx.link.findUniqueOrThrow({ where: { id: linkId }, select: LINK_SELECT });

async function discard(deps: Pick<PictureDeps, 'store' | 'log'>, keys: string[]): Promise<void> {
  for (const key of keys) {
    await deps.store.remove(key).catch((error: unknown) => deps.log.warn({ key, err: error instanceof Error ? error.message : String(error) }, 'link picture file could not be removed'));
  }
}

/** Appended last. A still is made a WEBP of at most 1600px; a GIF is stored as uploaded. */
export async function addLinkPicture(deps: PictureDeps, accountId: string, linkId: string, upload: { body: Buffer; contentType: string }): Promise<LinkRow> {
  const { pageId, gif } = await ownWidget(deps.prisma, accountId, linkId);
  const max = picturesAllowed(gif ? 'GIF' : 'PICTURES');
  // Early, so a full widget costs no decode and no upload; the count under the lock is the one that holds.
  if ((await deps.prisma.linkPicture.count({ where: { linkId } })) >= max) throw new PictureLimitError(max);
  const file = await prepareWidgetPicture(upload.body, upload.contentType, { gif, maxBytes: WIDGET_PICTURE_MAX_BYTES, edge: WIDGET_PICTURE_EDGE });
  if (!file) throw new InvalidPictureError(gif);

  const key = `links/${pageId}/${randomUUID()}.${file.ext}`;
  // Held before the put: a put that wrote and then threw still leaves a file, and removing a key never written is a no-op.
  try {
    await deps.store.put(key, file.body, file.contentType);
    return await deps.prisma.$transaction(async (tx) => {
      await lockWidget(tx, linkId);
      const now = await tx.linkPicture.aggregate({ where: { linkId }, _count: true, _max: { position: true } });
      if (now._count >= max) throw new PictureLimitError(max);
      await tx.linkPicture.create({
        data: { linkId, key, contentType: file.contentType, width: file.width, height: file.height, bytes: file.body.length, position: (now._max.position ?? -1) + 1 },
      });
      return resultOf(tx, linkId);
    });
  } catch (error) {
    await discard(deps, [key]);
    throw error;
  }
}

/** The pictures end up in the order `plan` returns (every id it leaves out is removed), under the widget's lock. */
async function rearrange(deps: PictureDeps, linkId: string, plan: (ids: string[]) => string[]): Promise<LinkRow> {
  let removed: string[] = [];
  const link = await deps.prisma.$transaction(async (tx) => {
    await lockWidget(tx, linkId);
    const rows = await tx.linkPicture.findMany({ where: { linkId }, orderBy: { position: 'asc' }, select: { id: true, key: true, position: true } });
    const finalIds = plan(rows.map((r) => r.id));
    const keep = new Set(finalIds);
    removed = rows.filter((r) => !keep.has(r.id)).map((r) => r.key);
    await tx.linkPicture.deleteMany({ where: { linkId, id: { notIn: finalIds } } });
    for (const [position, id] of finalIds.entries()) {
      if (rows.find((r) => r.id === id)?.position !== position) await tx.linkPicture.update({ where: { id }, data: { position } });
    }
    return resultOf(tx, linkId);
  });
  await discard(deps, removed);
  return link;
}

/** The picture's row goes, the pictures after it close the gap, then its file is deleted. */
export async function removeLinkPicture(deps: PictureDeps, accountId: string, linkId: string, pictureId: string): Promise<LinkRow> {
  await ownWidget(deps.prisma, accountId, linkId);
  return rearrange(deps, linkId, (ids) => {
    if (!ids.includes(pictureId)) throw new PictureNotFoundError();
    return ids.filter((id) => id !== pictureId);
  });
}

/** `ids` is exactly the widget's pictures, in their new order: anything else is stale (reorderLinks' rule). */
export async function reorderLinkPictures(deps: PictureDeps, accountId: string, linkId: string, ids: string[]): Promise<LinkRow> {
  await ownWidget(deps.prisma, accountId, linkId);
  return rearrange(deps, linkId, (current) => {
    const known = new Set(current);
    if (new Set(ids).size !== ids.length || ids.length !== known.size || ids.some((id) => !known.has(id))) throw new PictureOrderStaleError();
    return ids;
  });
}

/** Deletes objects after their rows are gone (a removed widget). Failures are logged, never thrown. */
export const discardPictureFiles = discard;
