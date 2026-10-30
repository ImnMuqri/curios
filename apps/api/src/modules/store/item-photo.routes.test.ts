import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { TOO_SMALL_SENTENCE } from '@curios/core/item-photos';
import { buildApp } from '../../app.js';
import { createSession, SESSION_COOKIE } from '../auth/session.service.js';
import type { AvatarStore } from '../pages/storage.js';
import { createDiskPrivateFiles, type PrivateFiles } from './private-files.js';

const store: AvatarStore & { put: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> } = {
  put: vi.fn(async () => undefined),
  remove: vi.fn(async () => undefined),
};

let app: FastifyInstance;
let root = '';
let files: PrivateFiles;
let nth = 0;
const from = () => `192.0.2.${(nth++ % 200) + 1}`;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'curios-item-photos-'));
  files = createDiskPrivateFiles(root);
  app = await buildApp({ pages: { store }, privateFiles: files });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await rm(root, { recursive: true, force: true });
});
beforeEach(() => {
  store.put.mockClear();
  store.remove.mockClear();
});

async function anOwner() {
  const slug = randomUUID().slice(0, 8);
  const account = await app.prisma.account.create({
    data: {
      email: `photos-${randomUUID()}@example.com`,
      emailVerifiedAt: new Date(),
      pages: { create: { handle: `ph-${slug}`, skeleton: `ph-${slug}`, displayName: 'Kek Lina', mode: 'BUSINESS' } },
    },
    select: { id: true, pages: { select: { id: true } } },
  });
  return { cookie: (await createSession(app.prisma, account.id)).value, pageId: account.pages[0]?.id ?? '' };
}
type Owner = Awaited<ReturnType<typeof anOwner>>;

const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, cookie?: string, payload?: object) =>
  app.inject({ method, url, remoteAddress: from(), ...(cookie ? { cookies: { [SESSION_COOKIE]: cookie } } : {}), ...(payload ? { payload } : {}) });

async function anItem(owner: Owner): Promise<string> {
  const res = await call('POST', '/store/items', owner.cookie, { name: 'Kek Batik', pricing: { kind: 'single', priceCents: 2500 } });
  expect(res.statusCode).toBe(201);
  return res.json<{ item: { id: string } }>().item.id;
}

const png = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#c86' } }).png().toBuffer();

const send = (owner: Owner | null, url: string, body: Buffer, frame: string, contentType = 'image/png') =>
  app.inject({
    method: 'POST',
    url,
    remoteAddress: from(),
    ...(owner ? { cookies: { [SESSION_COOKIE]: owner.cookie } } : {}),
    headers: { 'content-type': contentType, 'x-photo-frame': frame },
    payload: body,
  });

const add = (owner: Owner | null, itemId: string, body: Buffer, frame = '0.125,0,1', contentType = 'image/png') =>
  send(owner, `/store/items/${itemId}/photos`, body, frame, contentType);

type Photo = { id: string; squareKey: string; width: number; height: number; frame: { x: number; y: number; size: number } };
type Result = { photos: Photo[]; photoKey: string | null };

/** The keys `store.put` received, in order. */
const putKeys = () => store.put.mock.calls.map((c) => c[0] as string);

describe('POST /store/items/:id/photos', () => {
  it('adds the first photo: its square, and a cover on photoKey; no original key in the reply', async () => {
    const owner = await anOwner();
    const id = await anItem(owner);
    const res = await add(owner, id, await png(800, 600));
    expect(res.statusCode).toBe(201);
    const body = res.json<Result>();
    expect(body.photos).toHaveLength(1);
    expect(body.photos[0]).toMatchObject({ width: 800, height: 600, frame: { x: 0.125, y: 0, size: 1 } });
    expect(body.photoKey).toMatch(/^items\/.+\/cover-.+\.webp$/);
    expect(body.photos[0]?.squareKey).toMatch(new RegExp(`^items/${owner.pageId}/[^/]+\\.webp$`));
    expect(putKeys().sort()).toEqual([body.photos[0]?.squareKey, body.photoKey].sort());
    expect(res.body).not.toContain('item-photos/');

    // The square is 1080 and the cover 512.
    const sizes = await Promise.all(store.put.mock.calls.map(async (c) => (await sharp(c[1] as Buffer).metadata()).width));
    expect(sizes.sort()).toEqual([1080, 512]);

    // The original is in the private store, under the item's folder.
    const row = await app.prisma.itemPhoto.findFirstOrThrow({ where: { itemId: id } });
    expect(row.originalKey).toMatch(new RegExp(`^item-photos/${owner.pageId}/${id}/[^/]+\\.png$`));
    expect((await files.read(row.originalKey)).length).toBeGreaterThan(0);
    expect((await app.prisma.item.findUniqueOrThrow({ where: { id } })).photoKey).toBe(body.photoKey);

    // And the owner's item list carries the photos, without the original's key.
    const list = await call('GET', '/store', owner.cookie);
    expect(list.json<{ items: { id: string; photos: Photo[] }[] }>().items.find((i) => i.id === id)?.photos).toEqual(body.photos);
    expect(list.body).not.toContain('item-photos/');
  });

  it('adds a second photo last and leaves photoKey as it was', async () => {
    const owner = await anOwner();
    const id = await anItem(owner);
    const first = (await add(owner, id, await png(800, 600))).json<Result>();
    store.put.mockClear();
    const res = await add(owner, id, await png(600, 600), '0,0,1');
    expect(res.statusCode).toBe(201);
    const body = res.json<Result>();
    expect(body.photos.map((p) => p.id)).toEqual([first.photos[0]?.id, expect.any(String)]);
    expect(body.photos[1]).toMatchObject({ width: 600, height: 600 });
    expect(body.photoKey).toBe(first.photoKey);
    expect(putKeys()).toEqual([body.photos[1]?.squareKey]);
    expect(store.remove).not.toHaveBeenCalled();
  });

  it('refuses the 9th with PHOTO_LIMIT', async () => {
    const owner = await anOwner();
    const id = await anItem(owner);
    await seedPhotos(id, 8);
    const res = await add(owner, id, await png(800, 600));
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({ code: 'PHOTO_LIMIT', message: 'An item holds up to 8 photos.' });
    expect(store.put).not.toHaveBeenCalled();
  });

  // Review Focus 3.
  it('two adds at once onto 7 photos: one 201, one 409, and the item holds 8', async () => {
    const owner = await anOwner();
    const id = await anItem(owner);
    await seedPhotos(id, 7);
    const picture = await png(800, 600);
    // The item's row is held here until both adds are waiting on a lock, so both are past
    // their early count and inside their transactions at once. Without the service's own
    // row lock, both would count 7 there and then both insert (each insert's foreign-key
    // check waits on this hold too), leaving 9.
    let both: Promise<Awaited<ReturnType<typeof add>>[]> = Promise.resolve([]);
    await app.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Item" WHERE "id" = ${id} FOR UPDATE`;
        both = Promise.all([add(owner, id, picture), add(owner, id, picture)]);
        await waitForLockWaiters(2);
      },
      { timeout: 15_000 },
    );
    const results = await both;
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(await app.prisma.itemPhoto.count({ where: { itemId: id } })).toBe(8);
    const positions = (await app.prisma.itemPhoto.findMany({ where: { itemId: id }, orderBy: { position: 'asc' } })).map((p) => p.position);
    expect(positions).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    // The loser's square, put before the transaction, is deleted again.
    const kept = new Set((await app.prisma.itemPhoto.findMany({ where: { itemId: id } })).map((p) => p.squareKey));
    const orphans = putKeys().filter((key) => !kept.has(key));
    expect(orphans).toHaveLength(1);
    expect(store.remove).toHaveBeenCalledWith(orphans[0]);
  });

  it('refuses a frame outside the picture with INVALID_FRAME, and puts nothing', async () => {
    const owner = await anOwner();
    const id = await anItem(owner);
    const res = await add(owner, id, await png(800, 600), '0.5,0,1');
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_FRAME');
    expect(store.put).not.toHaveBeenCalled();
    expect(await app.prisma.itemPhoto.count({ where: { itemId: id } })).toBe(0);
  });

  it('refuses a missing or garbled frame header', async () => {
    const owner = await anOwner();
    const id = await anItem(owner);
    for (const frame of ['', 'a,b,c', '0,0', '0,0,1,1']) {
      expect((await add(owner, id, await png(800, 600), frame)).json().error.code).toBe('INVALID_FRAME');
    }
    expect(store.put).not.toHaveBeenCalled();
  });

  it('refuses a picture under 200 pixels with the too-small sentence', async () => {
    const owner = await anOwner();
    const id = await anItem(owner);
    const res = await add(owner, id, await png(150, 150), '0,0,1');
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toBe(TOO_SMALL_SENTENCE);
    expect(store.put).not.toHaveBeenCalled();
  });

  it('refuses what is not a picture, and a body over 8 MB, with INVALID_PHOTO', async () => {
    const owner = await anOwner();
    const id = await anItem(owner);
    expect((await add(owner, id, Buffer.from('%PDF-1.4 hello'))).json().error.code).toBe('INVALID_PHOTO');
    const big = Buffer.concat([await png(800, 600), Buffer.alloc(8_388_608)]);
    expect((await add(owner, id, big)).json().error.code).toBe('INVALID_PHOTO');
    expect(store.put).not.toHaveBeenCalled();
  });

  // Task 3's review: the square is cut from the upright picture.
  it('reads an EXIF-rotated JPEG upright and cuts a 1080 square from it', async () => {
    const owner = await anOwner();
    const id = await anItem(owner);
    const jpg = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#888' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const res = await add(owner, id, jpg, '0,0.125,0.75', 'image/jpeg');
    expect(res.statusCode).toBe(201);
    const photo = res.json<Result>().photos[0];
    expect(photo).toMatchObject({ width: 600, height: 800 });
    const square = store.put.mock.calls.find((c) => c[0] === photo?.squareKey)?.[1] as Buffer;
    expect(await sharp(square).metadata()).toMatchObject({ width: 1080, height: 1080 });
  });

  it('an item with an old photoKey and no photos: the first photo replaces it, and the old file is deleted', async () => {
    const owner = await anOwner();
    const id = await anItem(owner);
    const legacy = `items/${owner.pageId}/${randomUUID()}.webp`;
    await app.prisma.item.update({ where: { id }, data: { photoKey: legacy } });
    const body = (await add(owner, id, await png(800, 600))).json<Result>();
    expect(body.photoKey).not.toBe(legacy);
    expect(store.remove).toHaveBeenCalledWith(legacy);
  });

  it("will not add a photo to another owner's item", async () => {
    const a = await anOwner();
    const b = await anOwner();
    const id = await anItem(a);
    const res = await add(b, id, await png(800, 600));
    expect(res.statusCode).toBe(404);
    expect(store.put).not.toHaveBeenCalled();
  });
});

describe('PUT /store/items/:id/photos/:photoId/frame', () => {
  it('re-cropping the first photo gives a new square and a new cover, and removes both old ones', async () => {
    const owner = await anOwner();
    const id = await anItem(owner);
    const before = (await add(owner, id, await png(800, 600))).json<Result>();
    await add(owner, id, await png(600, 600), '0,0,1');
    store.put.mockClear();
    const photo = before.photos[0]!;
    const res = await call('PUT', `/store/items/${id}/photos/${photo.id}/frame`, owner.cookie, { x: 0, y: 0, size: 0.5 });
    expect(res.statusCode).toBe(200);
    const after = res.json<Result>();
    expect(after.photos[0]).toMatchObject({ id: photo.id, frame: { x: 0, y: 0, size: 0.5 } });
    expect(after.photos[0]?.squareKey).not.toBe(photo.squareKey);
    expect(after.photoKey).not.toBe(before.photoKey);
    expect(after.photoKey).toMatch(/^items\/.+\/cover-.+\.webp$/);
    expect(store.remove).toHaveBeenCalledWith(photo.squareKey);
    expect(store.remove).toHaveBeenCalledWith(before.photoKey);
    expect(after.photos).toHaveLength(2);
  });

  it('re-cropping the second photo leaves photoKey alone', async () => {
    const owner = await anOwner();
    const id = await anItem(owner);
    await add(owner, id, await png(800, 600));
    const before = (await add(owner, id, await png(800, 600))).json<Result>();
    store.put.mockClear();
    const second = before.photos[1]!;
    const after = (await call('PUT', `/store/items/${id}/photos/${second.id}/frame`, owner.cookie, { x: 0, y: 0, size: 1 })).json<Result>();
    expect(after.photoKey).toBe(before.photoKey);
    expect(after.photos[1]?.squareKey).not.toBe(second.squareKey);
    expect(putKeys()).toEqual([after.photos[1]?.squareKey]);
    expect(store.remove).toHaveBeenCalledWith(second.squareKey);
    expect(store.remove).not.toHaveBeenCalledWith(before.photoKey);
  });

  it('refuses a frame that leaves the picture, and an unknown photo', async () => {
    const owner = await anOwner();
    const id = await anItem(owner);
    const photo = (await add(owner, id, await png(800, 600))).json<Result>().photos[0]!;
    store.put.mockClear();
    expect((await call('PUT', `/store/items/${id}/photos/${photo.id}/frame`, owner.cookie, { x: 0.5, y: 0, size: 1 })).json().error.code).toBe('INVALID_FRAME');
    const missing = await call('PUT', `/store/items/${id}/photos/nope/frame`, owner.cookie, { x: 0, y: 0, size: 1 });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('PHOTO_NOT_FOUND');
    expect(store.put).not.toHaveBeenCalled();
  });
});

describe('POST /store/items/:id/photos/:photoId/picture', () => {
  it('replaces the picture in place: same id and position, new keys, the old original gone', async () => {
    const owner = await anOwner();
    const id = await anItem(owner);
    await add(owner, id, await png(800, 600));
    const before = (await add(owner, id, await png(800, 600))).json<Result>();
    const second = before.photos[1]!;
    const oldRow = await app.prisma.itemPhoto.findUniqueOrThrow({ where: { id: second.id } });
    store.put.mockClear();

    const res = await send(owner, `/store/items/${id}/photos/${second.id}/picture`, await png(1000, 500), '0.25,0,1');
    expect(res.statusCode).toBe(200);
    const after = res.json<Result>();
    expect(after.photos.map((p) => p.id)).toEqual(before.photos.map((p) => p.id));
    expect(after.photos[1]).toMatchObject({ id: second.id, width: 1000, height: 500, frame: { x: 0.25, y: 0, size: 1 } });
    expect(after.photos[1]?.squareKey).not.toBe(second.squareKey);
    expect(after.photoKey).toBe(before.photoKey);
    expect(store.remove).toHaveBeenCalledWith(second.squareKey);

    const newRow = await app.prisma.itemPhoto.findUniqueOrThrow({ where: { id: second.id } });
    expect(newRow.position).toBe(oldRow.position);
    expect(newRow.originalKey).not.toBe(oldRow.originalKey);
    await expect(files.read(oldRow.originalKey)).rejects.toThrow();
    expect((await files.read(newRow.originalKey)).length).toBeGreaterThan(0);
  });

  it('replacing the cover makes a new cover and removes the old one', async () => {
    const owner = await anOwner();
    const id = await anItem(owner);
    const before = (await add(owner, id, await png(800, 600))).json<Result>();
    const after = (await send(owner, `/store/items/${id}/photos/${before.photos[0]!.id}/picture`, await png(600, 600), '0,0,1')).json<Result>();
    expect(after.photoKey).not.toBe(before.photoKey);
    expect(after.photoKey).toMatch(/^items\/.+\/cover-.+\.webp$/);
    expect(store.remove).toHaveBeenCalledWith(before.photoKey);
  });

  it('a bad frame on the new picture leaves the photo as it was', async () => {
    const owner = await anOwner();
    const id = await anItem(owner);
    const photo = (await add(owner, id, await png(800, 600))).json<Result>().photos[0]!;
    store.put.mockClear();
    const res = await send(owner, `/store/items/${id}/photos/${photo.id}/picture`, await png(600, 600), '0.5,0,1');
    expect(res.json().error.code).toBe('INVALID_FRAME');
    expect(store.put).not.toHaveBeenCalled();
    expect((await app.prisma.itemPhoto.findUniqueOrThrow({ where: { id: photo.id } })).squareKey).toBe(photo.squareKey);
  });
});

describe('GET /store/items/:id/photos/:photoId/original', () => {
  // Review Focus 5.
  it("gives the owner the original's bytes, and nobody else", async () => {
    const owner = await anOwner();
    const other = await anOwner();
    const id = await anItem(owner);
    const picture = await png(800, 600);
    const photo = (await add(owner, id, picture)).json<Result>().photos[0]!;
    const url = `/store/items/${id}/photos/${photo.id}/original`;

    const res = await call('GET', url, owner.cookie);
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.equals(picture)).toBe(true);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(String(res.headers['content-disposition'])).toMatch(/^attachment;/);

    expect((await call('GET', url, other.cookie)).statusCode).toBe(404);
    expect((await call('GET', url)).statusCode).toBe(404);
    expect((await call('GET', `/store/items/${id}/photos/nope/original`, owner.cookie)).statusCode).toBe(404);
  });
});

const originalsOf = async (itemId: string) => (await app.prisma.itemPhoto.findMany({ where: { itemId }, select: { originalKey: true } })).map((p) => p.originalKey);
const gone = (key: string) => expect(files.read(key)).rejects.toThrow();
const ids = (r: Result) => r.photos.map((p) => p.id);

describe('DELETE /store/items/:id/photos/:photoId', () => {
  it('removing the first of three closes the gap, makes a new cover from the new first, and deletes the old files', async () => {
    const owner = await anOwner();
    const id = await anItem(owner);
    await add(owner, id, await png(800, 600));
    await add(owner, id, await png(600, 600), '0,0,1');
    const before = (await add(owner, id, await png(800, 600))).json<Result>();
    const [first, second] = before.photos as [Photo, Photo];
    const [firstOriginal] = await originalsOf(id);
    store.put.mockClear();
    const res = await call('DELETE', `/store/items/${id}/photos/${first.id}`, owner.cookie);
    expect(res.statusCode).toBe(200);
    const after = res.json<Result>();
    expect(ids(after)).toEqual([second.id, before.photos[2]!.id]);
    expect((await app.prisma.itemPhoto.findMany({ where: { itemId: id }, orderBy: { position: 'asc' }, select: { position: true } })).map((p) => p.position)).toEqual([0, 1]);
    expect(after.photoKey).not.toBe(before.photoKey);
    expect(after.photoKey).toMatch(/^items\/.+\/cover-.+\.webp$/);
    expect(putKeys()).toEqual([after.photoKey]);
    expect(store.remove).toHaveBeenCalledWith(before.photoKey);
    expect(store.remove).toHaveBeenCalledWith(first.squareKey);
    await gone(firstOriginal!);
  });

  it('removing a later photo leaves photoKey alone and puts nothing', async () => {
    const owner = await anOwner();
    const id = await anItem(owner);
    await add(owner, id, await png(800, 600));
    const before = (await add(owner, id, await png(800, 600))).json<Result>();
    store.put.mockClear();
    const after = (await call('DELETE', `/store/items/${id}/photos/${before.photos[1]!.id}`, owner.cookie)).json<Result>();
    expect(after.photoKey).toBe(before.photoKey);
    expect(after.photos).toHaveLength(1);
    expect(store.put).not.toHaveBeenCalled();
    expect(store.remove).not.toHaveBeenCalledWith(before.photoKey);
  });

  it('removing the only photo sets photoKey to null', async () => {
    const owner = await anOwner();
    const id = await anItem(owner);
    const before = (await add(owner, id, await png(800, 600))).json<Result>();
    const res = await call('DELETE', `/store/items/${id}/photos/${before.photos[0]!.id}`, owner.cookie);
    expect(res.json<Result>()).toEqual({ photos: [], photoKey: null });
    expect((await app.prisma.item.findUniqueOrThrow({ where: { id } })).photoKey).toBeNull();
    expect(store.remove).toHaveBeenCalledWith(before.photoKey);
  });

  it('an unknown photo is 404, and another owner gets 404 and nothing changes', async () => {
    const owner = await anOwner();
    const other = await anOwner();
    const id = await anItem(owner);
    const photo = (await add(owner, id, await png(800, 600))).json<Result>().photos[0]!;
    store.remove.mockClear();
    expect((await call('DELETE', `/store/items/${id}/photos/nope`, owner.cookie)).json().error.code).toBe('PHOTO_NOT_FOUND');
    expect((await call('DELETE', `/store/items/${id}/photos/${photo.id}`, other.cookie)).statusCode).toBe(404);
    expect(await app.prisma.itemPhoto.count({ where: { itemId: id } })).toBe(1);
    expect(store.remove).not.toHaveBeenCalled();
  });
});

describe('PUT /store/items/:id/photos/order', () => {
  it('moving another photo first gives a new cover from it', async () => {
    const owner = await anOwner();
    const id = await anItem(owner);
    await add(owner, id, await png(800, 600));
    await add(owner, id, await png(800, 600));
    const before = (await add(owner, id, await png(800, 600))).json<Result>();
    const [a, b, c] = ids(before) as [string, string, string];
    store.put.mockClear();
    const res = await call('PUT', `/store/items/${id}/photos/order`, owner.cookie, { ids: [c, a, b] });
    expect(res.statusCode).toBe(200);
    const after = res.json<Result>();
    expect(ids(after)).toEqual([c, a, b]);
    expect(after.photoKey).not.toBe(before.photoKey);
    expect(after.photoKey).toMatch(/^items\/.+\/cover-.+\.webp$/);
    expect(putKeys()).toEqual([after.photoKey]);
    expect(store.remove).toHaveBeenCalledWith(before.photoKey);
  });

  it('a reorder that keeps the first leaves photoKey as it was and puts nothing', async () => {
    const owner = await anOwner();
    const id = await anItem(owner);
    await add(owner, id, await png(800, 600));
    await add(owner, id, await png(800, 600));
    const before = (await add(owner, id, await png(800, 600))).json<Result>();
    const [a, b, c] = ids(before) as [string, string, string];
    store.put.mockClear();
    store.remove.mockClear();
    const after = (await call('PUT', `/store/items/${id}/photos/order`, owner.cookie, { ids: [a, c, b] })).json<Result>();
    expect(ids(after)).toEqual([a, c, b]);
    expect(after.photoKey).toBe(before.photoKey);
    expect(store.put).not.toHaveBeenCalled();
    expect(store.remove).not.toHaveBeenCalled();
  });

  it('a missing, extra, repeated or foreign id is 409 and changes nothing', async () => {
    const owner = await anOwner();
    const other = await anOwner();
    const id = await anItem(owner);
    const otherId = await anItem(other);
    await add(owner, id, await png(800, 600));
    const before = (await add(owner, id, await png(800, 600))).json<Result>();
    const foreign = (await add(other, otherId, await png(800, 600))).json<Result>().photos[0]!.id;
    const [a, b] = ids(before) as [string, string];
    store.put.mockClear();
    for (const bad of [[b], [b, a, a], [b, foreign], [b, a, foreign]]) {
      const res = await call('PUT', `/store/items/${id}/photos/order`, owner.cookie, { ids: bad });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('ITEM_ORDER_STALE');
    }
    const rows = await app.prisma.itemPhoto.findMany({ where: { itemId: id }, orderBy: { position: 'asc' }, select: { id: true } });
    expect(rows.map((r) => r.id)).toEqual([a, b]);
    expect(store.put).not.toHaveBeenCalled();
    expect((await app.prisma.item.findUniqueOrThrow({ where: { id } })).photoKey).toBe(before.photoKey);
  });

  it("another owner's item is 404", async () => {
    const owner = await anOwner();
    const other = await anOwner();
    const id = await anItem(owner);
    const photo = (await add(owner, id, await png(800, 600))).json<Result>().photos[0]!;
    expect((await call('PUT', `/store/items/${id}/photos/order`, other.cookie, { ids: [photo.id] })).statusCode).toBe(404);
  });
});

describe('DELETE /store/items/:id with photos', () => {
  it('removes the cover and every square from the public store, and every original from the private one', async () => {
    const owner = await anOwner();
    const id = await anItem(owner);
    await add(owner, id, await png(800, 600));
    const before = (await add(owner, id, await png(800, 600))).json<Result>();
    const originals = await originalsOf(id);
    expect(originals).toHaveLength(2);
    store.remove.mockClear();
    expect((await call('DELETE', `/store/items/${id}`, owner.cookie)).statusCode).toBe(200);
    const removed = store.remove.mock.calls.map((c) => c[0] as string).sort();
    expect(removed).toEqual([before.photoKey!, ...before.photos.map((p) => p.squareKey)].sort());
    for (const key of originals) await gone(key);
  });
});

describe("another owner's item", () => {
  it('add, re-crop and replace are all 404, and nothing is put', async () => {
    const owner = await anOwner();
    const other = await anOwner();
    const id = await anItem(owner);
    const photo = (await add(owner, id, await png(800, 600))).json<Result>().photos[0]!;
    store.put.mockClear();
    expect((await add(other, id, await png(800, 600))).statusCode).toBe(404);
    expect((await call('PUT', `/store/items/${id}/photos/${photo.id}/frame`, other.cookie, { x: 0, y: 0, size: 1 })).statusCode).toBe(404);
    expect((await send(other, `/store/items/${id}/photos/${photo.id}/picture`, await png(800, 600), '0,0,1')).statusCode).toBe(404);
    expect(store.put).not.toHaveBeenCalled();
  });
});

/** Waits until `n` database sessions are blocked on a lock (the adds, queued behind the test's hold). */
async function waitForLockWaiters(n: number): Promise<void> {
  await vi.waitFor(
    async () => {
      const [row] = await app.prisma.$queryRaw<{ waiting: bigint }[]>`
        SELECT count(*) AS waiting FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%Item%'`;
      expect(Number(row?.waiting ?? 0)).toBeGreaterThanOrEqual(n);
    },
    { timeout: 10_000, interval: 25 },
  );
}

/** Photo rows straight into the database, with keys nothing points at. */
async function seedPhotos(itemId: string, n: number): Promise<void> {
  await app.prisma.itemPhoto.createMany({
    data: Array.from({ length: n }, (_, position) => ({
      itemId,
      position,
      originalKey: `item-photos/seed/${randomUUID()}.png`,
      squareKey: `items/seed/${randomUUID()}.webp`,
      width: 800,
      height: 600,
      frameX: 0.125,
      frameY: 0,
      frameSize: 1,
    })),
  });
}
