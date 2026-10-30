import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@curios/db';
import { frameProblem, ITEM_COVER_EDGE, ITEM_PHOTO_EDGE, MAX_ITEM_PHOTOS, type Frame } from '@curios/core/item-photos';
import { cutSquare, readPicture } from '../../lib/item-photo-image.js';
import type { AvatarStore } from '../pages/storage.js';
import type { PrivateFiles } from './private-files.js';
import { InvalidFrameError, ItemNotFoundError, PhotoLimitError, PhotoNotFoundError } from './store.errors.js';
import { storePageFor } from './store-page.js';

/** A photo as its owner's editor sees it. The original's key is never in it: the original is fetched by id. */
export type OwnerPhoto = { id: string; squareKey: string; width: number; height: number; frame: Frame };
/** The body of every photo mutation: the item's photos in order, and its cover. */
export type PhotosResult = { photos: OwnerPhoto[]; photoKey: string | null };
export type PhotoDeps = {
  prisma: PrismaClient;
  /** Public: the squares and the cover. */
  store: AvatarStore;
  /** Private: the originals. */
  privateFiles: PrivateFiles;
  log: { warn: (o: object, msg: string) => void };
};

export const OWNER_PHOTO_SELECT = { id: true, squareKey: true, width: true, height: true, frameX: true, frameY: true, frameSize: true } as const;

export function toOwnerPhoto(row: Prisma.ItemPhotoGetPayload<{ select: typeof OWNER_PHOTO_SELECT }>): OwnerPhoto {
  return { id: row.id, squareKey: row.squareKey, width: row.width, height: row.height, frame: { x: row.frameX, y: row.frameY, size: row.frameSize } };
}

type Tx = Prisma.TransactionClient;
type Picture = { body: Buffer; contentType: string };

function checkFrame(frame: Frame, width: number, height: number): void {
  const problem = frameProblem(frame, width, height);
  if (problem) throw new InvalidFrameError(problem);
}

/** The owner's item, checked before any picture work or upload: another owner's item puts nothing. */
async function ownItem(prisma: PrismaClient, accountId: string, itemId: string): Promise<{ pageId: string }> {
  const page = await storePageFor(prisma, accountId);
  const item = await prisma.item.findFirst({ where: { id: itemId, pageId: page.id }, select: { id: true } });
  if (!item) throw new ItemNotFoundError();
  return { pageId: page.id };
}

/** The item's row lock: every photo write on one item waits its turn, so a count read under it holds until commit. */
async function lockItem(tx: Tx, pageId: string, itemId: string): Promise<{ photoKey: string | null }> {
  const rows = await tx.$queryRaw<{ photoKey: string | null }[]>`SELECT "photoKey" FROM "Item" WHERE "id" = ${itemId} AND "pageId" = ${pageId} FOR UPDATE`;
  const row = rows[0];
  if (!row) throw new ItemNotFoundError();
  return row;
}

async function resultOf(tx: Tx, itemId: string): Promise<PhotosResult> {
  const item = await tx.item.findUniqueOrThrow({
    where: { id: itemId },
    select: { photoKey: true, photos: { orderBy: { position: 'asc' }, select: OWNER_PHOTO_SELECT } },
  });
  return { photos: item.photos.map(toOwnerPhoto), photoKey: item.photoKey };
}

/** The photo became the first after the files were made (another was removed or moved): it needs a cover. */
class CoverNeeded extends Error {}

type Fresh = { squareKey: string; coverKey: string | null };
type Replaced = { public: string[]; private: string[] };
type Written = { result: PhotosResult; replaced: Replaced; coverUsed: boolean };

async function discard(deps: PhotoDeps, keys: Replaced): Promise<void> {
  for (const key of keys.public) {
    await deps.store.remove(key).catch((error: unknown) => deps.log.warn({ key, err: error instanceof Error ? error.message : String(error) }, 'item photo file could not be removed'));
  }
  for (const key of keys.private) {
    await deps.privateFiles.remove(key).catch((error: unknown) => deps.log.warn({ key, err: error instanceof Error ? error.message : String(error) }, 'item photo original could not be removed'));
  }
}

/**
 * Every mutation's tail. Puts the new files (an original when one came, the square, and a
 * cover when the photo is first), then runs `write` in one transaction, then deletes what it
 * replaced. Each new square and cover has a new key, so a cached old one is never served under
 * the new frame. If anything fails before the commit, the new files are deleted again.
 */
async function commit(
  deps: PhotoDeps,
  pageId: string,
  source: Buffer,
  frame: Frame,
  staged: { original: (Picture & { key: string }) | null; likelyFirst: boolean },
  write: (tx: Tx, fresh: Fresh) => Promise<Written>,
): Promise<PhotosResult> {
  const made: Replaced = { public: [], private: [] };
  const putCover = async (): Promise<string> => {
    const key = `items/${pageId}/cover-${randomUUID()}.webp`;
    await deps.store.put(key, await cutSquare(source, frame, ITEM_COVER_EDGE), 'image/webp');
    made.public.push(key);
    return key;
  };

  let written: Written;
  try {
    if (staged.original) {
      const { key, body, contentType } = staged.original;
      await deps.privateFiles.put(key, body, contentType, body.length);
      made.private.push(key);
    }
    const squareKey = `items/${pageId}/${randomUUID()}.webp`;
    await deps.store.put(squareKey, await cutSquare(source, frame, ITEM_PHOTO_EDGE), 'image/webp');
    made.public.push(squareKey);
    let coverKey = staged.likelyFirst ? await putCover() : null;
    const run = () => deps.prisma.$transaction((tx) => write(tx, { squareKey, coverKey }));
    try {
      written = await run();
    } catch (error) {
      if (!(error instanceof CoverNeeded)) throw error;
      coverKey = await putCover();
      written = await run();
    }
    // Made for a photo that turned out not to be first: nothing points at it.
    if (coverKey && !written.coverUsed) written.replaced.public.push(coverKey);
  } catch (error) {
    await discard(deps, made);
    throw error;
  }
  await discard(deps, written.replaced);
  return written.result;
}

/** Appended last. The first photo also sets the cover, replacing a photoKey from before photos (its file is deleted). */
export async function addItemPhoto(deps: PhotoDeps, accountId: string, itemId: string, picture: Picture, frame: Frame): Promise<PhotosResult> {
  const { pageId } = await ownItem(deps.prisma, accountId, itemId);
  const { width, height, ext } = await readPicture(picture.body, picture.contentType);
  checkFrame(frame, width, height);
  // Early, so a full item costs no upload; the count under the lock is the one that holds.
  const count = await deps.prisma.itemPhoto.count({ where: { itemId } });
  if (count >= MAX_ITEM_PHOTOS) throw new PhotoLimitError();
  const originalKey = `item-photos/${pageId}/${itemId}/${randomUUID()}.${ext}`;

  return commit(deps, pageId, picture.body, frame, { original: { ...picture, key: originalKey }, likelyFirst: count === 0 }, async (tx, fresh) => {
    const { photoKey } = await lockItem(tx, pageId, itemId);
    const now = await tx.itemPhoto.aggregate({ where: { itemId }, _count: true, _max: { position: true } });
    if (now._count >= MAX_ITEM_PHOTOS) throw new PhotoLimitError();
    const first = now._count === 0;
    if (first && !fresh.coverKey) throw new CoverNeeded();
    await tx.itemPhoto.create({
      data: { itemId, position: (now._max.position ?? -1) + 1, originalKey, squareKey: fresh.squareKey, width, height, frameX: frame.x, frameY: frame.y, frameSize: frame.size },
    });
    const replaced: Replaced = { public: [], private: [] };
    if (first) {
      await tx.item.update({ where: { id: itemId }, data: { photoKey: fresh.coverKey } });
      if (photoKey) replaced.public.push(photoKey);
    }
    return { result: await resultOf(tx, itemId), replaced, coverUsed: first };
  });
}

type Known = { originalKey: string; width: number; height: number; likelyFirst: boolean };

async function knownPhoto(prisma: PrismaClient, itemId: string, photoId: string): Promise<Known> {
  const photo = await prisma.itemPhoto.findFirst({ where: { id: photoId, itemId }, select: { originalKey: true, width: true, height: true } });
  if (!photo) throw new PhotoNotFoundError();
  const head = await prisma.itemPhoto.findFirst({ where: { itemId }, orderBy: { position: 'asc' }, select: { id: true } });
  return { ...photo, likelyFirst: head?.id === photoId };
}

/**
 * A new square for a photo in place, from its kept original (re-crop) or a new one (replace).
 * The photo keeps its id and position; when it is first, the cover is remade too.
 */
async function reframe(
  deps: PhotoDeps,
  pageId: string,
  itemId: string,
  photoId: string,
  known: Known,
  source: Buffer,
  frame: Frame,
  replacement: (Picture & { key: string; width: number; height: number }) | null,
): Promise<PhotosResult> {
  return commit(deps, pageId, source, frame, { original: replacement, likelyFirst: known.likelyFirst }, async (tx, fresh) => {
    const { photoKey } = await lockItem(tx, pageId, itemId);
    const current = await tx.itemPhoto.findFirst({ where: { id: photoId, itemId }, select: { originalKey: true, squareKey: true } });
    // Removed, or its picture replaced, since the frame was checked against it.
    if (!current || current.originalKey !== known.originalKey) throw new PhotoNotFoundError();
    const head = await tx.itemPhoto.findFirst({ where: { itemId }, orderBy: { position: 'asc' }, select: { id: true } });
    const first = head?.id === photoId;
    if (first && !fresh.coverKey) throw new CoverNeeded();
    await tx.itemPhoto.update({
      where: { id: photoId },
      data: {
        squareKey: fresh.squareKey,
        frameX: frame.x,
        frameY: frame.y,
        frameSize: frame.size,
        ...(replacement ? { originalKey: replacement.key, width: replacement.width, height: replacement.height } : {}),
      },
    });
    const replaced: Replaced = { public: [current.squareKey], private: replacement ? [current.originalKey] : [] };
    if (first) {
      await tx.item.update({ where: { id: itemId }, data: { photoKey: fresh.coverKey } });
      if (photoKey) replaced.public.push(photoKey);
    }
    return { result: await resultOf(tx, itemId), replaced, coverUsed: first };
  });
}

/** A new frame on the photo's kept original: only the frame is sent. */
export async function recropItemPhoto(deps: PhotoDeps, accountId: string, itemId: string, photoId: string, frame: Frame): Promise<PhotosResult> {
  const { pageId } = await ownItem(deps.prisma, accountId, itemId);
  const known = await knownPhoto(deps.prisma, itemId, photoId);
  checkFrame(frame, known.width, known.height);
  const source = await deps.privateFiles.read(known.originalKey);
  return reframe(deps, pageId, itemId, photoId, known, source, frame, null);
}

/** A new picture for the photo, in its place: its old original and square are deleted. */
export async function replaceItemPhoto(deps: PhotoDeps, accountId: string, itemId: string, photoId: string, picture: Picture, frame: Frame): Promise<PhotosResult> {
  const { pageId } = await ownItem(deps.prisma, accountId, itemId);
  const known = await knownPhoto(deps.prisma, itemId, photoId);
  const { width, height, ext } = await readPicture(picture.body, picture.contentType);
  checkFrame(frame, width, height);
  const key = `item-photos/${pageId}/${itemId}/${randomUUID()}.${ext}`;
  return reframe(deps, pageId, itemId, photoId, known, picture.body, frame, { ...picture, key, width, height });
}

/** The original's key, for its owner only; anyone else is told there is no such photo. */
export async function photoOriginal(prisma: PrismaClient, accountId: string, itemId: string, photoId: string): Promise<{ key: string; fileName: string }> {
  const page = await storePageFor(prisma, accountId);
  const photo = await prisma.itemPhoto.findFirst({ where: { id: photoId, itemId, item: { pageId: page.id } }, select: { originalKey: true } });
  if (!photo) throw new PhotoNotFoundError();
  const ext = photo.originalKey.slice(photo.originalKey.lastIndexOf('.') + 1);
  return { key: photo.originalKey, fileName: `photo-${photoId}.${ext}` };
}
