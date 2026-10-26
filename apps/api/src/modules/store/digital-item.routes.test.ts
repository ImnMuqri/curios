import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { MAX_DIGITAL_FILE_BYTES } from '@curios/core/digital';
import { buildApp } from '../../app.js';
import { createSession, SESSION_COOKIE } from '../auth/session.service.js';
import { cleanFileName, limitBytes, resolveDigital, NO_DIGITAL } from './digital-item.service.js';
import { createDiskPrivateFiles, type PrivateFiles } from './private-files.js';

let app: FastifyInstance;
let root = '';
let files: PrivateFiles;
let nth = 0;
const from = () => `198.51.100.${(nth++ % 200) + 1}`;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'curios-digital-'));
  files = createDiskPrivateFiles(root);
  app = await buildApp({ pages: { store: null }, privateFiles: files });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await rm(root, { recursive: true, force: true });
});

async function anOwner() {
  const slug = randomUUID().slice(0, 8);
  const account = await app.prisma.account.create({
    data: {
      email: `digital-${randomUUID()}@example.com`,
      emailVerifiedAt: new Date(),
      pages: { create: { handle: `dg-${slug}`, skeleton: `dg-${slug}`, displayName: 'Kek Lina', mode: 'BUSINESS' } },
    },
    select: { id: true, pages: { select: { id: true } } },
  });
  return { cookie: (await createSession(app.prisma, account.id)).value, pageId: account.pages[0]?.id ?? '' };
}
type Owner = Awaited<ReturnType<typeof anOwner>>;

const call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, cookie?: string, payload?: object) =>
  app.inject({ method, url, remoteAddress: from(), ...(cookie ? { cookies: { [SESSION_COOKIE]: cookie } } : {}), ...(payload ? { payload } : {}) });

const base = { name: 'Recipe e-book', pricing: { kind: 'single', priceCents: 2500 } };
async function anItem(owner: Owner, extra: object) {
  const res = await call('POST', '/store/items', owner.cookie, { ...base, ...extra });
  expect(res.statusCode).toBe(201);
  return res.json<{ item: { id: string } }>().item.id;
}
const fileItem = (o: Owner) => anItem(o, { kind: 'DIGITAL', delivery: 'FILES' });
const codeItem = (o: Owner) => anItem(o, { kind: 'DIGITAL', delivery: 'CODES' });
const sessionItem = (o: Owner) =>
  anItem(o, { kind: 'DIGITAL', delivery: 'SESSION', sessionMinutes: 90, sessionPlace: 'ONLINE', sessionWhere: 'https://meet.example.com/x' });

const upload = (owner: Owner | null, itemId: string, body: Buffer, headers: Record<string, string> = {}) =>
  app.inject({
    method: 'POST',
    url: `/store/items/${itemId}/files`,
    remoteAddress: from(),
    ...(owner ? { cookies: { [SESSION_COOKIE]: owner.cookie } } : {}),
    headers: { 'content-type': 'application/pdf', 'x-file-name': 'guide.pdf', ...headers },
    payload: body,
  });

const inFuture = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const PDF = Buffer.from('%PDF-1.4\nhello\n');

describe('digital fields on an item', () => {
  it('creates a digital item for each delivery and returns the fields', async () => {
    const owner = await anOwner();
    const link = await call('POST', '/store/items', owner.cookie, { ...base, kind: 'DIGITAL', delivery: 'LINK', accessUrl: ' https://notion.so/private ', accessNote: ' Password is in your email ' });
    expect(link.statusCode).toBe(201);
    expect(link.json().item).toMatchObject({ kind: 'DIGITAL', delivery: 'LINK', accessUrl: 'https://notion.so/private', accessNote: 'Password is in your email', files: [], codesLeft: 0, sessions: [] });
    const session = await call('POST', '/store/items', owner.cookie, { ...base, kind: 'DIGITAL', delivery: 'SESSION', sessionMinutes: 90, sessionPlace: 'IN_PERSON', sessionWhere: ' Seksyen 7, Shah Alam ' });
    expect(session.json().item).toMatchObject({ delivery: 'SESSION', sessionMinutes: 90, sessionPlace: 'IN_PERSON', sessionWhere: 'Seksyen 7, Shah Alam', accessUrl: null });
    expect((await call('POST', '/store/items', owner.cookie, { ...base })).json().item).toMatchObject({ kind: 'PHYSICAL', delivery: null });
  });

  it('refuses a digital item with no delivery, a non-https or missing link, a long note, and a session without minutes or place', async () => {
    const owner = await anOwner();
    const bad: object[] = [
      { kind: 'DIGITAL' },
      { kind: 'DIGITAL', delivery: 'LINK' },
      { kind: 'DIGITAL', delivery: 'LINK', accessUrl: 'http://example.com/x' },
      { kind: 'DIGITAL', delivery: 'LINK', accessUrl: 'javascript:alert(1)' },
      { kind: 'DIGITAL', delivery: 'LINK', accessUrl: 'not a url' },
      { kind: 'DIGITAL', delivery: 'LINK', accessUrl: 'https://example.com/x', accessNote: 'x'.repeat(201) },
      { kind: 'DIGITAL', delivery: 'SESSION', sessionPlace: 'ONLINE', sessionWhere: 'https://m.example.com' },
      { kind: 'DIGITAL', delivery: 'SESSION', sessionMinutes: 0, sessionPlace: 'ONLINE', sessionWhere: 'https://m.example.com' },
      { kind: 'DIGITAL', delivery: 'SESSION', sessionMinutes: 60, sessionWhere: 'https://m.example.com' },
      { kind: 'DIGITAL', delivery: 'SESSION', sessionMinutes: 60, sessionPlace: 'ONLINE', sessionWhere: '  ' },
    ];
    for (const extra of bad) {
      const res = await call('POST', '/store/items', owner.cookie, { ...base, ...extra });
      expect(res.statusCode, JSON.stringify(extra)).toBe(400);
      expect(res.json().error.code).toBe('INVALID_ITEM');
    }
    expect((await call('GET', '/store', owner.cookie)).json().items).toHaveLength(0);
  });

  it('judges a PATCH of one field against the whole item, and drops the fields a delivery does not use', async () => {
    const owner = await anOwner();
    const id = await anItem(owner, { kind: 'DIGITAL', delivery: 'LINK', accessUrl: 'https://example.com/a', accessNote: 'hi' });
    const bad = await call('PATCH', `/store/items/${id}`, owner.cookie, { accessUrl: 'http://example.com/a' });
    expect(bad.statusCode).toBe(400);
    const note = await call('PATCH', `/store/items/${id}`, owner.cookie, { accessNote: null });
    expect(note.json().item).toMatchObject({ accessUrl: 'https://example.com/a', accessNote: null });
    const toFiles = await call('PATCH', `/store/items/${id}`, owner.cookie, { delivery: 'FILES' });
    expect(toFiles.json().item).toMatchObject({ delivery: 'FILES', accessUrl: null, accessNote: null });
    // Not touching digital fields leaves them alone.
    const renamed = await call('PATCH', `/store/items/${id}`, owner.cookie, { name: 'Renamed' });
    expect(renamed.json().item).toMatchObject({ name: 'Renamed', kind: 'DIGITAL', delivery: 'FILES' });
  });

  it('switching to PHYSICAL clears the digital fields but keeps the rows, which come back on switching again', async () => {
    const owner = await anOwner();
    const id = await fileItem(owner);
    await upload(owner, id, PDF);
    const physical = await call('PATCH', `/store/items/${id}`, owner.cookie, { kind: 'PHYSICAL' });
    expect(physical.json().item).toMatchObject({ kind: 'PHYSICAL', delivery: null, accessUrl: null, sessionMinutes: null, files: [] });
    expect(await app.prisma.itemFile.count({ where: { itemId: id } })).toBe(1);
    const back = await call('PATCH', `/store/items/${id}`, owner.cookie, { kind: 'DIGITAL', delivery: 'FILES' });
    expect(back.json().item.files).toHaveLength(1);
  });

  it("will not change another owner's item", async () => {
    const a = await anOwner();
    const b = await anOwner();
    const id = await fileItem(a);
    expect((await call('PATCH', `/store/items/${id}`, b.cookie, { kind: 'PHYSICAL' })).statusCode).toBe(404);
  });

  it('resolveDigital clears everything for PHYSICAL and needs a delivery for DIGITAL', () => {
    expect(resolveDigital({ ...NO_DIGITAL, kind: 'DIGITAL', delivery: 'LINK', accessUrl: 'https://a.example' }, { kind: 'PHYSICAL' })).toEqual(NO_DIGITAL);
    expect(() => resolveDigital(NO_DIGITAL, { kind: 'DIGITAL' })).toThrow(/Choose how/);
  });
});

describe('POST /store/items/:id/files', () => {
  it('stores a file privately and answers its id, name and size', async () => {
    const owner = await anOwner();
    const id = await fileItem(owner);
    const res = await upload(owner, id, PDF, { 'x-file-name': encodeURIComponent('Resipi kek ✓.pdf') });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ id: expect.any(String), name: 'Resipi kek ✓.pdf', sizeBytes: PDF.length });
    expect(JSON.stringify(res.json())).not.toContain('digital/');
    const row = await app.prisma.itemFile.findFirstOrThrow({ where: { itemId: id } });
    expect(row.key.startsWith(`digital/${owner.pageId}/${id}/`)).toBe(true);
    expect(row.contentType).toBe('application/pdf');
    const delivered = await files.deliver(row.key, row.name);
    expect('stream' in delivered).toBe(true);
    const listed = (await call('GET', '/store', owner.cookie)).json().items[0];
    expect(listed.files).toEqual([{ id: row.id, name: 'Resipi kek ✓.pdf', sizeBytes: PDF.length }]);
    expect(JSON.stringify(listed)).not.toContain(row.key);
  });

  it('takes images, zip, audio and video; refuses other types with 415 and writes nothing', async () => {
    const owner = await anOwner();
    const id = await fileItem(owner);
    for (const type of ['image/png', 'application/zip', 'audio/mpeg', 'video/mp4']) {
      expect((await upload(owner, id, PDF, { 'content-type': type })).statusCode, type).toBe(201);
    }
    for (const type of ['text/html', 'application/x-msdownload', 'application/json', 'image/']) {
      const res = await upload(owner, id, PDF, { 'content-type': type });
      expect(res.statusCode, type).toBe(415);
      expect(res.json().error.code).toBe('FILE_TYPE');
    }
    expect(await app.prisma.itemFile.count({ where: { itemId: id } })).toBe(4);
  });

  it('takes a ZIP the way Windows browsers send it and stores it as application/zip', async () => {
    const owner = await anOwner();
    const id = await fileItem(owner);
    const res = await upload(owner, id, PDF, { 'content-type': 'application/x-zip-compressed', 'x-file-name': 'pack.zip' });
    expect(res.statusCode).toBe(201);
    expect((await app.prisma.itemFile.findFirstOrThrow({ where: { itemId: id } })).contentType).toBe('application/zip');
  });

  it('refuses a file over 100 MB from its declared length, 413 FILE_TOO_BIG, before reading it', async () => {
    const owner = await anOwner();
    const id = await fileItem(owner);
    const res = await upload(owner, id, Buffer.alloc(MAX_DIGITAL_FILE_BYTES + 1024 * 1024));
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe('FILE_TOO_BIG');
    expect(await app.prisma.itemFile.count({ where: { itemId: id } })).toBe(0);
  }, 30_000);

  it('refuses a sixth file with 409 TOO_MANY_FILES', async () => {
    const owner = await anOwner();
    const id = await fileItem(owner);
    for (let i = 0; i < 5; i++) expect((await upload(owner, id, PDF)).statusCode).toBe(201);
    const res = await upload(owner, id, PDF);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('TOO_MANY_FILES');
  });

  it('keeps to five when uploads run in parallel, and leaves no object behind for the ones refused', async () => {
    const owner = await anOwner();
    const id = await fileItem(owner);
    const results = await Promise.all(Array.from({ length: 8 }, () => upload(owner, id, PDF)));
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(5);
    expect(results.filter((r) => r.statusCode === 409)).toHaveLength(3);
    expect(await app.prisma.itemFile.count({ where: { itemId: id } })).toBe(5);
    const stored = (await readdir(path.join(root, 'digital', owner.pageId, id))).filter((n) => !n.endsWith('.type'));
    expect(stored).toHaveLength(5);
  });

  it('needs a session, an owned item, and an item that delivers files', async () => {
    const a = await anOwner();
    const b = await anOwner();
    const id = await fileItem(a);
    expect((await upload(null, id, PDF)).statusCode).toBe(401);
    expect((await upload(b, id, PDF)).statusCode).toBe(404);
    const link = await anItem(a, { kind: 'DIGITAL', delivery: 'LINK', accessUrl: 'https://example.com/x' });
    const wrong = await upload(a, link, PDF);
    expect(wrong.statusCode).toBe(409);
    expect(wrong.json().error.code).toBe('WRONG_DELIVERY');
    expect((await upload(a, 'nope', PDF)).statusCode).toBe(404);
  });

  it('refuses a missing or empty name or an empty body, and strips path parts from a name', async () => {
    const owner = await anOwner();
    const id = await fileItem(owner);
    expect((await upload(owner, id, PDF, { 'x-file-name': '' })).statusCode).toBe(400);
    expect((await upload(owner, id, PDF, { 'x-file-name': '%E0%A4%A' })).statusCode).toBe(400);
    expect((await upload(owner, id, Buffer.alloc(0))).statusCode).toBe(400);
    const res = await upload(owner, id, PDF, { 'x-file-name': encodeURIComponent('..\\..\\etc/passwd.pdf') });
    expect(res.json().name).toBe('passwd.pdf');
  });

  it('removes the stored object when saving the row fails', async () => {
    const owner = await anOwner();
    const id = await fileItem(owner);
    const failing: PrivateFiles = { ...files, put: async (key, body, type, size) => { await files.put(key, body, type, size); throw new Error('boom'); } };
    const own = await buildApp({ pages: { store: null }, privateFiles: failing });
    await own.ready();
    const res = await own.inject({
      method: 'POST',
      url: `/store/items/${id}/files`,
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: owner.cookie },
      headers: { 'content-type': 'application/pdf', 'x-file-name': 'a.pdf' },
      payload: PDF,
    });
    await own.close();
    expect(res.statusCode).toBe(500);
    expect(await app.prisma.itemFile.count({ where: { itemId: id } })).toBe(0);
    await expect(readdir(path.join(root, 'digital', owner.pageId, id))).resolves.toEqual([]);
  });
});

describe('limitBytes and cleanFileName', () => {
  it('stops a stream at the limit however much it claimed to carry', async () => {
    const counter = limitBytes(10);
    const source = Readable.from([Buffer.alloc(6), Buffer.alloc(6)]);
    const done = new Promise((resolve) => counter.on('error', resolve));
    source.pipe(counter);
    counter.resume();
    await expect(done).resolves.toMatchObject({ code: 'FILE_TOO_BIG', statusCode: 413 });
  });

  it('counts what passes through', async () => {
    const counter = limitBytes(100);
    await new Promise((resolve) => Readable.from([Buffer.alloc(40), Buffer.alloc(2)]).pipe(counter).on('data', () => undefined).on('end', resolve));
    expect(counter.bytes).toBe(42);
  });

  it('shortens a long name but keeps the extension', () => {
    const name = cleanFileName(encodeURIComponent(`${'a'.repeat(300)}.pdf`));
    expect([...name]).toHaveLength(200);
    expect(name.endsWith('.pdf')).toBe(true);
  });
});

describe('DELETE /store/items/:id/files/:fileId', () => {
  it('removes the row, then the stored object', async () => {
    const owner = await anOwner();
    const id = await fileItem(owner);
    const fileId = (await upload(owner, id, PDF)).json().id as string;
    const key = (await app.prisma.itemFile.findUniqueOrThrow({ where: { id: fileId } })).key;
    expect((await call('DELETE', `/store/items/${id}/files/${fileId}`, owner.cookie)).statusCode).toBe(200);
    expect(await app.prisma.itemFile.count({ where: { id: fileId } })).toBe(0);
    await expect(files.deliver(key, 'x.pdf')).rejects.toThrow();
  });

  it("is a 404 for another owner's file, and 401 without a session", async () => {
    const a = await anOwner();
    const b = await anOwner();
    const id = await fileItem(a);
    const fileId = (await upload(a, id, PDF)).json().id as string;
    expect((await call('DELETE', `/store/items/${id}/files/${fileId}`, b.cookie)).statusCode).toBe(404);
    expect((await call('DELETE', `/store/items/${id}/files/${fileId}`)).statusCode).toBe(401);
    expect(await app.prisma.itemFile.count({ where: { id: fileId } })).toBe(1);
  });

  it('removing the item removes its stored files too', async () => {
    const owner = await anOwner();
    const id = await fileItem(owner);
    await upload(owner, id, PDF);
    const key = (await app.prisma.itemFile.findFirstOrThrow({ where: { itemId: id } })).key;
    expect((await call('DELETE', `/store/items/${id}`, owner.cookie)).statusCode).toBe(200);
    await expect(files.deliver(key, 'x.pdf')).rejects.toThrow();
  });
});

describe('codes', () => {
  it('adds the parsed codes, drops blanks and repeats, and counts what is left', async () => {
    const owner = await anOwner();
    const id = await codeItem(owner);
    const first = await call('PUT', `/store/items/${id}/codes`, owner.cookie, { text: ' AAA \r\n\r\nBBB\nAAA\nCCC\n' });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ added: 3, left: 3 });
    const second = await call('PUT', `/store/items/${id}/codes`, owner.cookie, { text: 'CCC\nDDD' });
    expect(second.json()).toEqual({ added: 1, left: 4 });
    const item = (await call('GET', '/store', owner.cookie)).json().items[0];
    expect(item.codesLeft).toBe(4);
    expect(JSON.stringify(item)).not.toContain('AAA');
  });

  it('does not count a code given to a buyer as left, and will not remove it', async () => {
    const owner = await anOwner();
    const id = await codeItem(owner);
    await call('PUT', `/store/items/${id}/codes`, owner.cookie, { text: 'AAA\nBBB' });
    const order = await app.prisma.order.create({
      data: { pageId: owner.pageId, number: 1, code: 'ABCD', tokenHash: randomUUID(), customerName: 'A', phone: '+60123456789', itemsCents: 1, deliveryCents: 0, totalCents: 1, lines: { create: { itemId: id, itemName: 'x', unitPriceCents: 1, quantity: 1, position: 0 } } },
      select: { lines: { select: { id: true } } },
    });
    const used = await app.prisma.itemCode.findFirstOrThrow({ where: { itemId: id, code: 'AAA' } });
    await app.prisma.itemCode.update({ where: { id: used.id }, data: { orderLineId: order.lines[0]?.id, givenAt: new Date() } });
    const refused = await call('DELETE', `/store/items/${id}/codes/${used.id}`, owner.cookie);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('CODE_USED');
    expect((await call('PUT', `/store/items/${id}/codes`, owner.cookie, { text: 'AAA' })).json()).toEqual({ added: 0, left: 1 });
    const unused = await app.prisma.itemCode.findFirstOrThrow({ where: { itemId: id, code: 'BBB' } });
    const gone = await call('DELETE', `/store/items/${id}/codes/${unused.id}`, owner.cookie);
    expect(gone.statusCode).toBe(200);
    expect(gone.json()).toEqual({ status: 'removed', left: 0 });
  });

  it('refuses to remove an item whose codes buyers hold or have reserved (409 ITEM_HAS_SALES), but removes one with only free codes', async () => {
    const owner = await anOwner();
    const id = await codeItem(owner);
    await call('PUT', `/store/items/${id}/codes`, owner.cookie, { text: 'AAA\nBBB' });
    const order = await app.prisma.order.create({
      data: { pageId: owner.pageId, number: 1, code: 'ABCD', tokenHash: randomUUID(), customerName: 'A', phone: '+60123456789', itemsCents: 1, deliveryCents: 0, totalCents: 1, lines: { create: { itemId: id, itemName: 'x', unitPriceCents: 1, quantity: 1, position: 0 } } },
      select: { lines: { select: { id: true } } },
    });
    const used = await app.prisma.itemCode.findFirstOrThrow({ where: { itemId: id, code: 'AAA' } });
    await app.prisma.itemCode.update({ where: { id: used.id }, data: { orderLineId: order.lines[0]?.id, givenAt: new Date() } });
    const refused = await call('DELETE', `/store/items/${id}`, owner.cookie);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('ITEM_HAS_SALES');
    expect(refused.json().error.message).toBe('Buyers hold codes from this item. Mark it unavailable instead.');
    expect(await app.prisma.itemCode.count({ where: { itemId: id } })).toBe(2);
    // A code an unpaid order has reserved, not yet given, is held as well.
    await app.prisma.itemCode.update({ where: { id: used.id }, data: { givenAt: null } });
    expect((await call('DELETE', `/store/items/${id}`, owner.cookie)).json().error.code).toBe('ITEM_HAS_SALES');
    expect(await app.prisma.itemCode.count({ where: { itemId: id } })).toBe(2);
    const free = await codeItem(owner);
    await call('PUT', `/store/items/${free}/codes`, owner.cookie, { text: 'ZZZ' });
    expect((await call('DELETE', `/store/items/${free}`, owner.cookie)).statusCode).toBe(200);
  });

  it('waits for a checkout mid-way through taking a code, then refuses to remove the item', async () => {
    const owner = await anOwner();
    const id = await codeItem(owner);
    await call('PUT', `/store/items/${id}/codes`, owner.cookie, { text: 'AAA' });
    let removal: ReturnType<typeof call> | undefined;
    // What checkout does, held open: the page's lock, the order, its code taken -- and the owner's
    // removal arriving before it commits.
    await app.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Page" WHERE "id" = ${owner.pageId} FOR UPDATE`;
      const order = await tx.order.create({
        data: { pageId: owner.pageId, number: 1, code: 'ABCD', tokenHash: randomUUID(), customerName: 'A', phone: '+60123456789', itemsCents: 1, deliveryCents: 0, totalCents: 1, lines: { create: { itemId: id, itemName: 'x', unitPriceCents: 1, quantity: 1, position: 0 } } },
        select: { lines: { select: { id: true } } },
      });
      await tx.itemCode.updateMany({ where: { itemId: id }, data: { orderLineId: order.lines[0]?.id } });
      removal = call('DELETE', `/store/items/${id}`, owner.cookie);
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
    const refused = await removal!;
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('ITEM_HAS_SALES');
    expect(await app.prisma.itemCode.count({ where: { itemId: id } })).toBe(1);
  });

  it('refuses over-long codes, another owner, a non-code item, and no session', async () => {
    const a = await anOwner();
    const b = await anOwner();
    const id = await codeItem(a);
    const long = await call('PUT', `/store/items/${id}/codes`, a.cookie, { text: 'x'.repeat(201) });
    expect(long.statusCode).toBe(400);
    expect(long.json().error.code).toBe('INVALID_CODES');
    expect((await call('PUT', `/store/items/${id}/codes`, b.cookie, { text: 'A' })).statusCode).toBe(404);
    expect((await call('PUT', `/store/items/${id}/codes`, undefined, { text: 'A' })).statusCode).toBe(401);
    const files = await fileItem(a);
    expect((await call('PUT', `/store/items/${files}/codes`, a.cookie, { text: 'A' })).json().error.code).toBe('WRONG_DELIVERY');
    const code = await app.prisma.itemCode.create({ data: { itemId: id, code: 'Z' } });
    expect((await call('DELETE', `/store/items/${id}/codes/${code.id}`, b.cookie)).statusCode).toBe(404);
  });
});

describe('sessions', () => {
  async function booked(owner: Owner, itemId: string, sessionId: string, seats: number) {
    const order = await app.prisma.order.create({
      data: { pageId: owner.pageId, number: 1, code: 'ABCD', tokenHash: randomUUID(), customerName: 'A', phone: '+60123456789', itemsCents: 1, deliveryCents: 0, totalCents: 1, lines: { create: { itemId, itemName: 'x', unitPriceCents: 1, quantity: seats, position: 0 } } },
      select: { lines: { select: { id: true } } },
    });
    await app.prisma.sessionBooking.create({ data: { sessionId, orderLineId: order.lines[0]?.id ?? '', seats } });
  }

  it('adds a time, lists it with seats left, and edits it', async () => {
    const owner = await anOwner();
    const id = await sessionItem(owner);
    const startsAt = inFuture(7);
    const made = await call('POST', `/store/items/${id}/sessions`, owner.cookie, { startsAt, seats: 12 });
    expect(made.statusCode).toBe(201);
    expect(made.json().session).toMatchObject({ startsAt, seats: 12, booked: 0, seatsLeft: 12 });
    const sessionId = made.json().session.id as string;
    await booked(owner, id, sessionId, 7);
    const listed = (await call('GET', '/store', owner.cookie)).json().items[0].sessions;
    expect(listed).toEqual([{ id: sessionId, startsAt, seats: 12, booked: 7, seatsLeft: 5 }]);
    const patched = await call('PATCH', `/store/items/${id}/sessions/${sessionId}`, owner.cookie, { seats: 20 });
    expect(patched.json().session).toMatchObject({ startsAt, seats: 20, booked: 7, seatsLeft: 13 });
    const free = (await call('POST', `/store/items/${id}/sessions`, owner.cookie, { startsAt: inFuture(9), seats: 4 })).json().session.id as string;
    const later = inFuture(8);
    expect((await call('PATCH', `/store/items/${id}/sessions/${free}`, owner.cookie, { startsAt: later })).json().session).toMatchObject({ startsAt: later });
  });

  it('refuses seats below the booked count with 409 SEATS_BOOKED, but allows exactly that many', async () => {
    const owner = await anOwner();
    const id = await sessionItem(owner);
    const sessionId = (await call('POST', `/store/items/${id}/sessions`, owner.cookie, { startsAt: inFuture(3), seats: 10 })).json().session.id as string;
    await booked(owner, id, sessionId, 4);
    const refused = await call('PATCH', `/store/items/${id}/sessions/${sessionId}`, owner.cookie, { seats: 3 });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('SEATS_BOOKED');
    expect((await call('PATCH', `/store/items/${id}/sessions/${sessionId}`, owner.cookie, { seats: 4 })).json().session).toMatchObject({ seats: 4, seatsLeft: 0 });
  });

  it('needs an explicit UTC offset on a time', async () => {
    const owner = await anOwner();
    const id = await sessionItem(owner);
    const bare = inFuture(5).replace(/\.\d+Z$/, '');
    const post = (startsAt: string) => call('POST', `/store/items/${id}/sessions`, owner.cookie, { startsAt, seats: 5 });
    expect((await post(bare)).statusCode).toBe(400);
    expect((await post(inFuture(5))).statusCode).toBe(201);
    expect((await post(bare + '+08:00')).statusCode).toBe(201);
  });

  it('will not move a time that has bookings, but still lets seats change', async () => {
    const owner = await anOwner();
    const id = await sessionItem(owner);
    const sessionId = (await call('POST', `/store/items/${id}/sessions`, owner.cookie, { startsAt: inFuture(3), seats: 5 })).json().session.id as string;
    await booked(owner, id, sessionId, 1);
    const moved = await call('PATCH', `/store/items/${id}/sessions/${sessionId}`, owner.cookie, { startsAt: inFuture(4) });
    expect(moved.statusCode).toBe(409);
    expect(moved.json().error.code).toBe('SESSION_BOOKED');
    expect((await call('PATCH', `/store/items/${id}/sessions/${sessionId}`, owner.cookie, { seats: 8 })).statusCode).toBe(200);
  });

  it('deletes a time with no bookings, and refuses one with bookings (409 SESSION_BOOKED)', async () => {
    const owner = await anOwner();
    const id = await sessionItem(owner);
    const free = (await call('POST', `/store/items/${id}/sessions`, owner.cookie, { startsAt: inFuture(3), seats: 5 })).json().session.id as string;
    const full = (await call('POST', `/store/items/${id}/sessions`, owner.cookie, { startsAt: inFuture(4), seats: 5 })).json().session.id as string;
    await booked(owner, id, full, 1);
    expect((await call('DELETE', `/store/items/${id}/sessions/${free}`, owner.cookie)).statusCode).toBe(200);
    const refused = await call('DELETE', `/store/items/${id}/sessions/${full}`, owner.cookie);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('SESSION_BOOKED');
    expect(await app.prisma.itemSession.count({ where: { itemId: id } })).toBe(1);
  });

  it('refuses to remove an item that has booked times (409 ITEM_HAS_BOOKINGS) and nothing is lost', async () => {
    const owner = await anOwner();
    const id = await sessionItem(owner);
    const sessionId = (await call('POST', `/store/items/${id}/sessions`, owner.cookie, { startsAt: inFuture(3), seats: 5 })).json().session.id as string;
    await booked(owner, id, sessionId, 2);
    const refused = await call('DELETE', `/store/items/${id}`, owner.cookie);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('ITEM_HAS_BOOKINGS');
    expect(await app.prisma.item.count({ where: { id } })).toBe(1);
    // An item whose times have no bookings goes, with them.
    const other = await sessionItem(owner);
    await call('POST', `/store/items/${other}/sessions`, owner.cookie, { startsAt: inFuture(3), seats: 5 });
    expect((await call('DELETE', `/store/items/${other}`, owner.cookie)).statusCode).toBe(200);
  });

  it('refuses a past time, a bad date, bad seats, another owner, a non-session item, and no session', async () => {
    const a = await anOwner();
    const b = await anOwner();
    const id = await sessionItem(a);
    const post = (cookie: string | undefined, payload: object, item = id) => call('POST', `/store/items/${item}/sessions`, cookie, payload);
    expect((await post(a.cookie, { startsAt: inFuture(-1), seats: 5 })).json().error.code).toBe('INVALID_SESSION');
    expect((await post(a.cookie, { startsAt: 'tomorrow', seats: 5 })).statusCode).toBe(400);
    for (const seats of [0, -2, 2.5, 100_000]) expect((await post(a.cookie, { startsAt: inFuture(2), seats })).json().error.code).toBe('INVALID_SESSION');
    expect((await post(b.cookie, { startsAt: inFuture(2), seats: 5 })).statusCode).toBe(404);
    expect((await post(undefined, { startsAt: inFuture(2), seats: 5 })).statusCode).toBe(401);
    const files = await fileItem(a);
    expect((await post(a.cookie, { startsAt: inFuture(2), seats: 5 }, files)).json().error.code).toBe('WRONG_DELIVERY');
    const sessionId = (await post(a.cookie, { startsAt: inFuture(2), seats: 5 })).json().session.id as string;
    expect((await call('PATCH', `/store/items/${id}/sessions/${sessionId}`, b.cookie, { seats: 6 })).statusCode).toBe(404);
    expect((await call('DELETE', `/store/items/${id}/sessions/${sessionId}`, b.cookie)).statusCode).toBe(404);
    expect((await call('DELETE', `/store/items/${id}/sessions/${sessionId}`)).statusCode).toBe(401);
  });
});
