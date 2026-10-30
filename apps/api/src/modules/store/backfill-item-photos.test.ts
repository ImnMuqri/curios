import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import type { AvatarStore } from '../pages/storage.js';
import { backfillItemPhotos } from './backfill-item-photos.js';
import { createDiskPrivateFiles, type PrivateFiles } from './private-files.js';

const store: AvatarStore & { put: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> } = {
  put: vi.fn(async () => undefined),
  remove: vi.fn(async () => undefined),
};

let app: FastifyInstance;
let root = '';
let files: PrivateFiles;
let png: Buffer;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'curios-backfill-'));
  files = createDiskPrivateFiles(root);
  app = await buildApp({ pages: { store }, privateFiles: files });
  await app.ready();
  png = await sharp({ create: { width: 512, height: 512, channels: 3, background: '#c86' } }).png().toBuffer();
});
afterAll(async () => {
  await app.close();
  await rm(root, { recursive: true, force: true });
});
beforeEach(() => {
  store.put.mockClear();
  store.remove.mockClear();
});

/** A page with one item per key given; `null` is an item with no photo. */
async function aShop(photoKeys: (string | null)[]) {
  const slug = randomUUID().slice(0, 8);
  const account = await app.prisma.account.create({
    data: {
      email: `backfill-${randomUUID()}@example.com`,
      emailVerifiedAt: new Date(),
      pages: { create: { handle: `bf-${slug}`, skeleton: `bf-${slug}`, displayName: 'Kek Lina', mode: 'BUSINESS' } },
    },
    select: { pages: { select: { id: true } } },
  });
  const pageId = account.pages[0]?.id ?? '';
  const items = [];
  for (const [position, photoKey] of photoKeys.entries()) {
    items.push(
      await app.prisma.item.create({
        data: { pageId, name: `Item ${position}`, slug: `item-${position}`, position, priceCents: 1000, photoKey },
      }),
    );
  }
  return { pageId, items };
}

const known = (key: string) => `items/known/${key}.webp`;
const fetchPublic = async (key: string) => (key.startsWith('items/known/') ? png : null);

const run = (pageId: string, write: boolean) => {
  const lines: string[] = [];
  const result = backfillItemPhotos({
    prisma: app.prisma,
    fetchPublic,
    store,
    privateFiles: files,
    write,
    log: (line) => lines.push(line),
    onlyPageIds: [pageId],
  });
  return result.then((r) => ({ ...r, lines }));
};

describe('backfillItemPhotos', () => {
  it('a dry run reports the candidates and creates and puts nothing', async () => {
    const { pageId, items } = await aShop([known('a'), known('b'), null]);
    const result = await run(pageId, false);
    expect(result).toMatchObject({ candidates: 2, copied: 0, unreadable: [] });
    expect(result.lines.join('\n')).toContain(items[0]!.id);
    expect(store.put).not.toHaveBeenCalled();
    expect(await app.prisma.itemPhoto.count({ where: { item: { pageId } } })).toBe(0);
  });

  it('write mode gives each candidate one row with new keys, a readable original, and photoKey untouched', async () => {
    const { pageId, items } = await aShop([known('a'), known('b'), null]);
    const result = await run(pageId, true);
    expect(result).toMatchObject({ candidates: 2, copied: 2, unreadable: [] });
    expect(store.put).toHaveBeenCalledTimes(2);

    for (const item of items.slice(0, 2)) {
      const rows = await app.prisma.itemPhoto.findMany({ where: { itemId: item.id } });
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row).toMatchObject({ position: 0, width: 512, height: 512, frameX: 0, frameY: 0, frameSize: 1 });
      expect(row.squareKey).toMatch(new RegExp(`^items/${pageId}/[^/]+\\.png$`));
      expect(row.squareKey).not.toBe(item.photoKey);
      expect(row.originalKey).toMatch(new RegExp(`^item-photos/${pageId}/${item.id}/[^/]+\\.png$`));
      expect((await files.read(row.originalKey)).equals(png)).toBe(true);
      expect((await app.prisma.item.findUniqueOrThrow({ where: { id: item.id } })).photoKey).toBe(item.photoKey);
    }
    expect(await app.prisma.itemPhoto.count({ where: { item: { id: items[2]!.id } } })).toBe(0);

    // Re-running finds nothing.
    store.put.mockClear();
    expect(await run(pageId, true)).toMatchObject({ candidates: 0, copied: 0, unreadable: [] });
    expect(store.put).not.toHaveBeenCalled();
  });

  it('lists a missing or undecodable picture as unreadable and leaves that item without a row', async () => {
    const { pageId, items } = await aShop([known('a'), 'items/gone/missing.webp']);
    const result = await run(pageId, true);
    expect(result).toMatchObject({ candidates: 2, copied: 1 });
    expect(result.unreadable).toHaveLength(1);
    expect(result.unreadable[0]).toContain(items[1]!.id);
    expect(await app.prisma.itemPhoto.count({ where: { itemId: items[1]!.id } })).toBe(0);

    const garbage = await aShop([known('a')]);
    const bad = await backfillItemPhotos({
      prisma: app.prisma,
      fetchPublic: async () => Buffer.from('not a picture'),
      store,
      privateFiles: files,
      write: true,
      log: () => undefined,
      onlyPageIds: [garbage.pageId],
    });
    expect(bad.unreadable).toHaveLength(1);
    expect(await app.prisma.itemPhoto.count({ where: { item: { pageId: garbage.pageId } } })).toBe(0);
  });

  it('skips an item that already has rows', async () => {
    const { pageId, items } = await aShop([known('a')]);
    await app.prisma.itemPhoto.create({
      data: { itemId: items[0]!.id, position: 0, originalKey: 'item-photos/x/y/z.png', squareKey: 'items/x/z.webp', width: 10, height: 10, frameX: 0, frameY: 0, frameSize: 1 },
    });
    expect(await run(pageId, true)).toMatchObject({ candidates: 0, copied: 0 });
    expect(store.put).not.toHaveBeenCalled();
  });

  it('removes its two new files when the row cannot be created', async () => {
    const { pageId } = await aShop([known('a')]);
    const failing = {
      ...app.prisma,
      item: app.prisma.item,
      itemPhoto: { create: async () => { throw new Error('boom'); } },
    } as unknown as typeof app.prisma;
    const removed: string[] = [];
    const privateFiles: PrivateFiles = { ...files, remove: async (key) => { removed.push(key); await files.remove(key); } };
    await expect(
      backfillItemPhotos({ prisma: failing, fetchPublic, store, privateFiles, write: true, log: () => undefined, onlyPageIds: [pageId] }),
    ).resolves.toMatchObject({ copied: 0 });
    expect(removed).toHaveLength(1);
    expect(store.remove).toHaveBeenCalledTimes(1);
    expect(store.remove.mock.calls[0]?.[0]).toBe(store.put.mock.calls[0]?.[0]);
  });
});
