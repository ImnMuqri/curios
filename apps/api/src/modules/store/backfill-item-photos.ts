import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@curios/db';
import { fullFrame } from '@curios/core/item-photos';
import { readPicture } from '../../lib/item-photo-image.js';
import { SIGNATURES } from '../pages/avatar.js';
import type { AvatarStore } from '../pages/storage.js';
import type { PrivateFiles } from './private-files.js';

export interface BackfillDeps {
  prisma: PrismaClient;
  /** The bytes at a public key, or null when they cannot be had. */
  fetchPublic: (key: string) => Promise<Buffer | null>;
  store: AvatarStore;
  privateFiles: PrivateFiles;
  /** False only reports what would be done. */
  write: boolean;
  log: (line: string) => void;
  /** Limits the run to these pages (tests); the script leaves it out. */
  onlyPageIds?: string[];
}

const CONTENT_TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' } as const;

/**
 * Gives each item that has a cover (`photoKey`) but no ItemPhoto rows one row of
 * its own: the old cover's bytes as a new private original and as a new public
 * square, under new keys. `photoKey` is left as it is. Items with rows are not
 * picked, so a re-run finds nothing.
 */
export async function backfillItemPhotos(deps: BackfillDeps): Promise<{ candidates: number; copied: number; unreadable: string[] }> {
  const { prisma, fetchPublic, store, privateFiles, write, log } = deps;
  const items = await prisma.item.findMany({
    where: { photoKey: { not: null }, photos: { none: {} }, ...(deps.onlyPageIds ? { pageId: { in: deps.onlyPageIds } } : {}) },
    select: { id: true, pageId: true, name: true, photoKey: true },
    orderBy: { createdAt: 'asc' },
  });
  const unreadable: string[] = [];
  let copied = 0;

  for (const item of items) {
    const label = `${item.id} (${item.name})`;
    if (!write) {
      log(`would copy ${label}: ${item.photoKey}`);
      continue;
    }
    const bytes = await fetchPublic(item.photoKey!).catch(() => null);
    if (!bytes) {
      unreadable.push(`${label}: could not fetch ${item.photoKey}`);
      continue;
    }
    const picture = await readAny(bytes);
    if (!picture) {
      unreadable.push(`${label}: ${item.photoKey} is not a readable picture`);
      continue;
    }
    const { ext, width, height } = picture;
    const contentType = CONTENT_TYPES[ext];
    const name = randomUUID();
    const originalKey = `item-photos/${item.pageId}/${item.id}/${name}.${ext}`;
    const squareKey = `items/${item.pageId}/${name}.${ext}`;
    await privateFiles.put(originalKey, bytes, contentType, bytes.length);
    try {
      await store.put(squareKey, bytes, contentType);
    } catch (error) {
      await privateFiles.remove(originalKey).catch(() => undefined);
      throw error;
    }
    try {
      const frame = fullFrame(width, height);
      await prisma.itemPhoto.create({
        data: { itemId: item.id, position: 0, originalKey, squareKey, width, height, frameX: frame.x, frameY: frame.y, frameSize: frame.size },
      });
    } catch (error) {
      log(`${label}: could not create its row (${String(error)}); its new files are removed`);
      await privateFiles.remove(originalKey).catch(() => undefined);
      await store.remove(squareKey).catch(() => undefined);
      continue;
    }
    copied += 1;
    log(`copied ${label}`);
  }

  return { candidates: items.length, copied, unreadable };
}

/** The old cover's type is not recorded, so the first type its bytes pass as is the one. */
async function readAny(bytes: Buffer): Promise<{ width: number; height: number; ext: 'jpg' | 'png' | 'webp' } | null> {
  for (const type of Object.keys(SIGNATURES)) {
    try {
      return await readPicture(bytes, type);
    } catch {
      // try the next type
    }
  }
  return null;
}
