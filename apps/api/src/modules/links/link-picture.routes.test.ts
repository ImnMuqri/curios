import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { MAX_LINKS } from '@curios/core/bento';
import { buildApp } from '../../app.js';
import { createSession, SESSION_COOKIE } from '../auth/session.service.js';
import type { AvatarStore } from '../pages/storage.js';

// Storage is a mock: nothing here reaches a real bucket.
const store: AvatarStore & { put: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> } = {
  put: vi.fn(async () => undefined),
  remove: vi.fn(async () => undefined),
};

let app: FastifyInstance;
let nth = 0;
const from = () => `198.51.100.${(nth++ % 200) + 1}`;

beforeAll(async () => {
  app = await buildApp({ links: { store } });
  await app.ready();
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  store.put.mockClear();
  store.remove.mockClear();
});

async function anOwner() {
  const slug = randomUUID().slice(0, 8);
  const account = await app.prisma.account.create({
    data: {
      email: `lpics-${randomUUID()}@example.com`,
      emailVerifiedAt: new Date(),
      pages: { create: { handle: `lp-${slug}`, skeleton: `lp-${slug}`, displayName: 'Iman' } },
    },
    select: { id: true, pages: { select: { id: true } } },
  });
  return { cookie: (await createSession(app.prisma, account.id)).value, pageId: account.pages[0]?.id ?? '' };
}
type Owner = Awaited<ReturnType<typeof anOwner>>;

const call = (cookie: string, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url, remoteAddress: from(), cookies: { [SESSION_COOKIE]: cookie }, ...(payload ? { payload } : {}) });

const upload = (cookie: string, id: string, body: Buffer, contentType: string, headers: Record<string, string> = {}) =>
  app.inject({
    method: 'POST',
    url: `/links/${id}/pictures`,
    remoteAddress: from(),
    cookies: { [SESSION_COOKIE]: cookie },
    headers: { 'content-type': contentType, ...headers },
    payload: body,
  });

type Pic = { id: string; key: string; width: number; height: number; contentType: string; bytes: number; position: number };
type Row = { id: string; label: string; url: string; kind: string; provider: string; embedRef: string | null; pictureMode: string | null; altText: string | null; pictures: Pic[] };

const png = (w = 400, h = 300) => sharp({ create: { width: w, height: h, channels: 3, background: '#e07' } }).png().toBuffer();
const jpeg = (w = 400, h = 300) => sharp({ create: { width: w, height: h, channels: 3, background: '#07e' } }).jpeg().toBuffer();
const gif = () => sharp({ create: { width: 120, height: 80, channels: 3, background: '#0a0' } }).gif().toBuffer();

async function aWidget(owner: Owner, body: object = { provider: 'PICTURES', mode: 'CAROUSEL', label: 'Fresh out of the oven', altText: 'Kek on a tray' }): Promise<Row> {
  const res = await call(owner.cookie, 'POST', '/links/pictures', body);
  expect(res.statusCode).toBe(201);
  return res.json<{ link: Row }>().link;
}

describe('POST /links/pictures', () => {
  it('makes an empty Pictures widget with its caption, mode and description', async () => {
    const owner = await anOwner();
    const link = await aWidget(owner);
    expect(link).toMatchObject({ kind: 'WIDGET', provider: 'PICTURES', label: 'Fresh out of the oven', embedRef: null, pictureMode: 'CAROUSEL', altText: 'Kek on a tray', pictures: [] });
    const list = await call(owner.cookie, 'GET', '/links');
    expect(list.json<{ links: Row[] }>().links.map((l) => l.id)).toEqual([link.id]);
  });

  it('names a GIF widget GIF and defaults its mode to full width', async () => {
    const owner = await anOwner();
    const link = await aWidget(owner, { provider: 'GIF' });
    expect(link).toMatchObject({ provider: 'GIF', label: 'GIF', pictureMode: 'FULL', altText: null });
  });

  it('refuses a mode a GIF cannot take, and a too-long description', async () => {
    const owner = await anOwner();
    expect((await call(owner.cookie, 'POST', '/links/pictures', { provider: 'GIF', mode: 'GRID' })).json().error.code).toBe('INVALID_WIDGET');
    expect((await call(owner.cookie, 'POST', '/links/pictures', { provider: 'PICTURES', altText: 'x'.repeat(301) })).json().error.code).toBe('INVALID_WIDGET');
  });

  it('counts toward the link limit', async () => {
    const owner = await anOwner();
    await app.prisma.link.createMany({ data: Array.from({ length: MAX_LINKS }, (_, i) => ({ pageId: owner.pageId, label: `L${i}`, url: 'https://example.com', position: i })) });
    const res = await call(owner.cookie, 'POST', '/links/pictures', { provider: 'PICTURES' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('LINK_LIMIT');
  });
});

describe('POST /links/:id/pictures', () => {
  it('stores a still as an upright WEBP no bigger than 1600px, without its metadata', async () => {
    const owner = await anOwner();
    const widget = await aWidget(owner);
    // 3000x2000 stored sideways with EXIF orientation 6: upright it is 2000x3000, then scaled to 1067x1600.
    const big = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#abc' } })
      .jpeg()
      .withMetadata({ orientation: 6, exif: { IFD0: { Copyright: 'Someone' } } })
      .toBuffer();

    const res = await upload(owner.cookie, widget.id, big, 'image/jpeg');

    expect(res.statusCode).toBe(201);
    const pic = res.json<{ link: Row }>().link.pictures[0]!;
    expect(pic).toMatchObject({ contentType: 'image/webp', width: 1067, height: 1600, position: 0 });
    expect(pic.key).toMatch(new RegExp(`^links/${owner.pageId}/[0-9a-f-]{36}\\.webp$`));
    expect(store.put).toHaveBeenCalledTimes(1);
    const [key, body, type] = store.put.mock.calls[0] as [string, Buffer, string];
    expect(key).toBe(pic.key);
    expect(type).toBe('image/webp');
    const meta = await sharp(body).metadata();
    expect(meta).toMatchObject({ format: 'webp', width: 1067, height: 1600 });
    expect(meta.exif).toBeUndefined();
    expect(pic.bytes).toBe(body.length);
  });

  it('keeps a small picture its size and appends in order', async () => {
    const owner = await anOwner();
    const widget = await aWidget(owner);
    await upload(owner.cookie, widget.id, await png(), 'image/png');
    const res = await upload(owner.cookie, widget.id, await jpeg(200, 100), 'image/jpeg');
    const pics = res.json<{ link: Row }>().link.pictures;
    expect(pics.map((p) => [p.position, p.width, p.height])).toEqual([
      [0, 400, 300],
      [1, 200, 100],
    ]);
  });

  it('holds six pictures and refuses a seventh without storing it', async () => {
    const owner = await anOwner();
    const widget = await aWidget(owner);
    const one = await png(100, 100);
    for (let i = 0; i < 6; i++) expect((await upload(owner.cookie, widget.id, one, 'image/png')).statusCode).toBe(201);
    store.put.mockClear();
    const res = await upload(owner.cookie, widget.id, one, 'image/png');
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('PICTURE_LIMIT');
    expect(store.put).not.toHaveBeenCalled();
  });

  it('refuses bytes that are not the claimed type, an unknown type, and a GIF in a Pictures widget', async () => {
    const owner = await anOwner();
    const widget = await aWidget(owner);
    for (const [body, type] of [
      [await png(), 'image/jpeg'],
      [Buffer.from('not an image'), 'image/png'],
      [await png(), 'image/bmp'],
      [await gif(), 'image/gif'],
    ] as const) {
      const res = await upload(owner.cookie, widget.id, body, type);
      expect(res.statusCode, type).toBe(400);
      expect(res.json().error.code).toBe('INVALID_PICTURE');
    }
    expect(store.put).not.toHaveBeenCalled();
  });

  it('refuses a file over 10 MB by its declared length, before reading it', async () => {
    const owner = await anOwner();
    const widget = await aWidget(owner);
    const res = await upload(owner.cookie, widget.id, await png(), 'image/png', { 'content-length': String(10 * 1024 * 1024 + 1) });
    expect([400, 413]).toContain(res.statusCode);
    expect(store.put).not.toHaveBeenCalled();
  });

  it('stores a GIF as uploaded, one only, and refuses a still in a GIF widget', async () => {
    const owner = await anOwner();
    const widget = await aWidget(owner, { provider: 'GIF', mode: 'SQUARE' });
    expect((await upload(owner.cookie, widget.id, await png(), 'image/png')).json().error.code).toBe('INVALID_PICTURE');
    expect((await upload(owner.cookie, widget.id, await png(), 'image/gif')).json().error.code).toBe('INVALID_PICTURE');

    const bytes = await gif();
    const res = await upload(owner.cookie, widget.id, bytes, 'image/gif');
    expect(res.statusCode).toBe(201);
    const pic = res.json<{ link: Row }>().link.pictures[0]!;
    expect(pic).toMatchObject({ contentType: 'image/gif', width: 120, height: 80, bytes: bytes.length });
    expect(pic.key).toMatch(new RegExp(`^links/${owner.pageId}/[0-9a-f-]{36}\\.gif$`));
    const [, stored, type] = store.put.mock.calls[0] as [string, Buffer, string];
    expect(stored.equals(bytes)).toBe(true);
    expect(type).toBe('image/gif');

    const again = await upload(owner.cookie, widget.id, bytes, 'image/gif');
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('PICTURE_LIMIT');
  });

  it('refuses a GIF that is too wide, has too many frames, or is too big in all', async () => {
    const owner = await anOwner();
    const widget = await aWidget(owner, { provider: 'GIF' });
    const wide = await sharp({ create: { width: 2001, height: 4, channels: 3, background: '#fff' } }).gif().toBuffer();
    // A 1x1 GIF with 301 frames, written by hand: sharp cannot make an animated one here.
    const frame = Buffer.from([0x21, 0xf9, 4, 0, 0, 0, 0, 0, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 1, 0]);
    const head = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0x80, 0, 0, 0, 0, 0, 255, 255, 255]);
    const many = Buffer.concat([head, ...Array<Buffer>(301).fill(frame), Buffer.from([0x3b])]);
    const few = Buffer.concat([head, ...Array<Buffer>(300).fill(frame), Buffer.from([0x3b])]);
    for (const body of [wide, many]) {
      const res = await upload(owner.cookie, widget.id, body, 'image/gif');
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('INVALID_PICTURE');
    }
    expect(store.put).not.toHaveBeenCalled();
    expect((await upload(owner.cookie, widget.id, few, 'image/gif')).statusCode).toBe(201);
  });

  it('answers an oversize GIF with the GIF sentence', async () => {
    const owner = await anOwner();
    const widget = await aWidget(owner, { provider: 'GIF' });
    const res = await upload(owner.cookie, widget.id, await gif(), 'image/gif', { 'content-length': String(10 * 1024 * 1024 + 1) });
    expect(res.json().error.message).toBe('Use a GIF, up to 10 MB.');
  });

  it('checks the widget before the body: a wrong id is a 404 even for garbage', async () => {
    const owner = await anOwner();
    const res = await upload(owner.cookie, 'nope', Buffer.from('garbage'), 'image/png');
    expect(res.statusCode).toBe(404);
  });

  it('limits uploads per account', async () => {
    const owner = await anOwner();
    let last = 0;
    for (let i = 0; i < 21; i++) last = (await upload(owner.cookie, 'nope', Buffer.from('x'), 'image/png')).statusCode;
    expect(last).toBe(429);
  });

  it('takes nothing for a plain link, a missing link, or another owner widget', async () => {
    const owner = await anOwner();
    const other = await anOwner();
    const widget = await aWidget(owner);
    const plain = (await call(owner.cookie, 'POST', '/links', { label: 'WA', url: 'wa.me/60123' })).json<{ link: Row }>().link;
    for (const [cookie, id] of [
      [owner.cookie, plain.id],
      [owner.cookie, 'nope'],
      [other.cookie, widget.id],
    ] as const) {
      const res = await upload(cookie, id, await png(), 'image/png');
      expect(res.statusCode).toBe(404);
    }
    expect(store.put).not.toHaveBeenCalled();
  });
});

describe('removing and ordering pictures', () => {
  async function withThree() {
    const owner = await anOwner();
    const widget = await aWidget(owner);
    const ids: string[] = [];
    for (const w of [101, 102, 103]) ids.push((await upload(owner.cookie, widget.id, await png(w, 50), 'image/png')).json<{ link: Row }>().link.pictures.at(-1)!.id);
    return { owner, widget, ids };
  }

  it('removes one picture, its file, and closes the gap', async () => {
    const { owner, widget, ids } = await withThree();
    const keys = (await app.prisma.linkPicture.findMany({ where: { linkId: widget.id }, orderBy: { position: 'asc' }, select: { key: true } })).map((p) => p.key);
    store.remove.mockClear();

    const res = await call(owner.cookie, 'DELETE', `/links/${widget.id}/pictures/${ids[0]}`);

    expect(res.statusCode).toBe(200);
    expect(res.json<{ link: Row }>().link.pictures.map((p) => [p.id, p.position])).toEqual([
      [ids[1], 0],
      [ids[2], 1],
    ]);
    expect(store.remove).toHaveBeenCalledWith(keys[0]);
    expect(store.remove).toHaveBeenCalledTimes(1);
    expect((await call(owner.cookie, 'DELETE', `/links/${widget.id}/pictures/${ids[0]}`)).statusCode).toBe(404);
  });

  it('reorders, and calls a list that is not exactly the pictures stale', async () => {
    const { owner, widget, ids } = await withThree();
    const [a, b, c] = ids as [string, string, string];
    const res = await call(owner.cookie, 'PUT', `/links/${widget.id}/pictures/order`, { ids: [c, a, b] });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ link: Row }>().link.pictures.map((p) => p.id)).toEqual([c, a, b]);
    for (const bad of [[c, a], [c, a, b, b], [c, a, 'zzz']]) {
      const stale = await call(owner.cookie, 'PUT', `/links/${widget.id}/pictures/order`, { ids: bad });
      expect(stale.statusCode).toBe(409);
      expect(stale.json().error.code).toBe('PICTURE_ORDER_STALE');
    }
  });

  it('removing the widget removes every picture file', async () => {
    const { owner, widget } = await withThree();
    const keys = (await app.prisma.linkPicture.findMany({ where: { linkId: widget.id }, select: { key: true } })).map((p) => p.key);
    store.remove.mockClear();

    expect((await call(owner.cookie, 'DELETE', `/links/${widget.id}`)).statusCode).toBe(200);

    expect(store.remove.mock.calls.map((c) => c[0] as string).sort()).toEqual([...keys].sort());
    expect(await app.prisma.linkPicture.count({ where: { linkId: widget.id } })).toBe(0);
  });
});

describe('PATCH /links/:id on a picture widget', () => {
  it('changes caption, mode and description; an empty description clears it', async () => {
    const owner = await anOwner();
    const widget = await aWidget(owner);
    const res = await call(owner.cookie, 'PATCH', `/links/${widget.id}`, { label: ' Raya batch ', pictureMode: 'GRID', altText: 'Six cakes' });
    expect(res.json<{ link: Row }>().link).toMatchObject({ label: 'Raya batch', pictureMode: 'GRID', altText: 'Six cakes' });
    const cleared = await call(owner.cookie, 'PATCH', `/links/${widget.id}`, { altText: '  ' });
    expect(cleared.json<{ link: Row }>().link.altText).toBeNull();
  });

  it('refuses an address, a mode the widget cannot take, or a mode on a plain link', async () => {
    const owner = await anOwner();
    const widget = await aWidget(owner);
    const gifW = await aWidget(owner, { provider: 'GIF' });
    const plain = (await call(owner.cookie, 'POST', '/links', { label: 'WA', url: 'wa.me/60123' })).json<{ link: Row }>().link;
    for (const [id, body] of [
      [widget.id, { url: 'https://example.com' }],
      [gifW.id, { pictureMode: 'CAROUSEL' }],
      [plain.id, { pictureMode: 'FULL' }],
      [plain.id, { altText: 'x' }],
    ] as const) {
      const res = await call(owner.cookie, 'PATCH', `/links/${id}`, body);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('INVALID_WIDGET');
    }
  });
});
