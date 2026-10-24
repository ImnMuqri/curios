import { randomBytes } from 'node:crypto';
import { Transform } from 'node:stream';
import type { Prisma, PrismaClient } from '@curios/db';
import { ACCESS_NOTE_MAX, DIGITAL_FILE_TYPES, MAX_DIGITAL_FILES, MAX_DIGITAL_FILE_BYTES, parseCodes, seatsLeft } from '@curios/core/digital';
import type { PrivateFiles } from './private-files.js';
import {
  CodeNotFoundError,
  CodeUsedError,
  FileNotFoundError,
  FileTooBigError,
  FileTypeError,
  InvalidCodesError,
  InvalidFileError,
  InvalidItemError,
  InvalidSessionError,
  ItemNotFoundError,
  SeatsBookedError,
  SessionBookedError,
  SessionNotFoundError,
  TooManyFilesError,
  WrongDeliveryError,
} from './store.errors.js';
import { storePageFor } from './store-page.js';

export type ItemKind = 'PHYSICAL' | 'DIGITAL';
export type Delivery = 'FILES' | 'LINK' | 'CODES' | 'SESSION';
export type Place = 'ONLINE' | 'IN_PERSON';

/** The digital columns an item carries, as the API sends and takes them. */
export interface DigitalFields {
  kind: ItemKind;
  delivery: Delivery | null;
  accessUrl: string | null;
  accessNote: string | null;
  sessionMinutes: number | null;
  sessionPlace: Place | null;
  sessionWhere: string | null;
}

export interface DigitalInput {
  kind?: ItemKind;
  delivery?: Delivery | null;
  accessUrl?: string | null;
  accessNote?: string | null;
  sessionMinutes?: number | null;
  sessionPlace?: Place | null;
  sessionWhere?: string | null;
}

export const NO_DIGITAL: DigitalFields = {
  kind: 'PHYSICAL',
  delivery: null,
  accessUrl: null,
  accessNote: null,
  sessionMinutes: null,
  sessionPlace: null,
  sessionWhere: null,
};

export const DIGITAL_COLUMNS = {
  kind: true,
  delivery: true,
  accessUrl: true,
  accessNote: true,
  sessionMinutes: true,
  sessionPlace: true,
  sessionWhere: true,
} as const;

/** What the editor shows of a digital item: never a file's key, never a code's text. */
export const DIGITAL_RELATIONS = {
  files: { orderBy: { position: 'asc' }, select: { id: true, name: true, sizeBytes: true } },
  sessions: { orderBy: { startsAt: 'asc' }, select: { id: true, startsAt: true, seats: true, bookings: { select: { seats: true } } } },
  _count: { select: { codes: { where: { orderLineId: null } } } },
} as const satisfies Prisma.ItemSelect;

export interface SessionRow {
  id: string;
  startsAt: Date;
  seats: number;
  booked: number;
  seatsLeft: number;
}

export interface DigitalDetail {
  files: { id: string; name: string; sizeBytes: number }[];
  codesLeft: number;
  sessions: SessionRow[];
}

export function sessionRow(row: { id: string; startsAt: Date; seats: number; bookings: { seats: number }[] }): SessionRow {
  const booked = row.bookings.reduce((sum, b) => sum + b.seats, 0);
  return { id: row.id, startsAt: row.startsAt, seats: row.seats, booked, seatsLeft: seatsLeft(row, booked) };
}

/**
 * Files, codes and times show only while the item is digital and set to deliver them.
 * Rows from before a switch stay in the database (past orders may rest on them) and
 * come back if the owner switches back.
 */
export function digitalDetail(row: {
  kind: ItemKind;
  delivery: Delivery | null;
  files: { id: string; name: string; sizeBytes: number }[];
  sessions: { id: string; startsAt: Date; seats: number; bookings: { seats: number }[] }[];
  _count: { codes: number };
}): DigitalDetail {
  const digital = row.kind === 'DIGITAL';
  return {
    files: digital && row.delivery === 'FILES' ? row.files : [],
    codesLeft: digital && row.delivery === 'CODES' ? row._count.codes : 0,
    sessions: digital && row.delivery === 'SESSION' ? row.sessions.map(sessionRow) : [],
  };
}

const SESSION_MINUTES_MAX = 24 * 60;
const SESSION_WHERE_MAX = 400;
const URL_MAX = 2000;

function httpsUrl(raw: string): string {
  const text = raw.trim();
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new InvalidItemError('Give a link that starts with https://.');
  }
  if (url.protocol !== 'https:' || url.hostname === '' || [...text].length > URL_MAX) throw new InvalidItemError('Give a link that starts with https://.');
  return text;
}

/**
 * The digital columns an item ends up with: what it has now, overlaid with what was
 * sent. PHYSICAL clears everything; DIGITAL needs a delivery; each delivery keeps
 * only its own fields, so a stale link never outlives a switch to files.
 */
export function resolveDigital(current: DigitalFields, input: DigitalInput): DigitalFields {
  const merged: DigitalFields = {
    kind: input.kind ?? current.kind,
    delivery: input.delivery !== undefined ? input.delivery : current.delivery,
    accessUrl: input.accessUrl !== undefined ? input.accessUrl : current.accessUrl,
    accessNote: input.accessNote !== undefined ? input.accessNote : current.accessNote,
    sessionMinutes: input.sessionMinutes !== undefined ? input.sessionMinutes : current.sessionMinutes,
    sessionPlace: input.sessionPlace !== undefined ? input.sessionPlace : current.sessionPlace,
    sessionWhere: input.sessionWhere !== undefined ? input.sessionWhere : current.sessionWhere,
  };
  if (merged.kind === 'PHYSICAL') return { ...NO_DIGITAL };
  if (merged.delivery === null) throw new InvalidItemError('Choose how buyers get a digital item: files, a link, codes or a session.');
  const out: DigitalFields = { ...NO_DIGITAL, kind: 'DIGITAL', delivery: merged.delivery };
  if (merged.delivery === 'LINK') {
    if (merged.accessUrl === null || merged.accessUrl.trim() === '') throw new InvalidItemError('Add the link buyers get, starting with https://.');
    out.accessUrl = httpsUrl(merged.accessUrl);
    const note = merged.accessNote?.trim() ?? '';
    if ([...note].length > ACCESS_NOTE_MAX) throw new InvalidItemError(`Keep the note to ${ACCESS_NOTE_MAX} characters.`);
    out.accessNote = note === '' ? null : note;
  }
  if (merged.delivery === 'SESSION') {
    const minutes = merged.sessionMinutes;
    if (minutes === null || !Number.isInteger(minutes) || minutes < 1 || minutes > SESSION_MINUTES_MAX) {
      throw new InvalidItemError(`Say how long it runs, in minutes, up to ${SESSION_MINUTES_MAX}.`);
    }
    if (merged.sessionPlace === null) throw new InvalidItemError('Choose online or in person.');
    const where = merged.sessionWhere?.trim() ?? '';
    if (where === '') throw new InvalidItemError(merged.sessionPlace === 'ONLINE' ? 'Add the meeting link buyers get.' : 'Add where it takes place.');
    if ([...where].length > SESSION_WHERE_MAX) throw new InvalidItemError(`Keep the place or link to ${SESSION_WHERE_MAX} characters.`);
    out.sessionMinutes = minutes;
    out.sessionPlace = merged.sessionPlace;
    out.sessionWhere = where;
  }
  return out;
}

/** Locks the item's row until the transaction ends, so counts taken under it cannot be raced. */
async function lockItem(tx: Prisma.TransactionClient, id: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Item" WHERE id = ${id} FOR UPDATE`;
}

/** The owner's item, only while it delivers `delivery`. */
async function ownItem(tx: Prisma.TransactionClient | PrismaClient, accountId: string, id: string, delivery: Delivery, what: string) {
  const page = await storePageFor(tx as PrismaClient, accountId);
  const item = await tx.item.findFirst({ where: { id, pageId: page.id }, select: { id: true, pageId: true, kind: true, delivery: true } });
  if (!item) throw new ItemNotFoundError();
  if (item.kind !== 'DIGITAL' || item.delivery !== delivery) throw new WrongDeliveryError(what);
  return item;
}

// ---- files ----------------------------------------------------------------

export const FILE_NAME_MAX = 200;

const FILE_TYPE_PATTERNS = DIGITAL_FILE_TYPES.map((type) => (type.endsWith('/*') ? { prefix: type.slice(0, -1) } : { exact: type }));

/** The bare media type of a Content-Type header, lower-cased, or null if it is not an allowed file type. */
export function allowedFileType(header: string | undefined): string | null {
  const type = (header ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (type === '') return null;
  const ok = FILE_TYPE_PATTERNS.some((p) => ('exact' in p ? type === p.exact : type.startsWith(p.prefix) && type.length > p.prefix.length));
  return ok ? type : null;
}

export function assertFileType(header: string | undefined): string {
  const type = allowedFileType(header);
  if (!type) throw new FileTypeError();
  return type;
}

export const FILE_MB = MAX_DIGITAL_FILE_BYTES / 1_048_576;

/** The length a request declares; absent or not a whole positive number is refused. Over the limit is FILE_TOO_BIG. */
export function declaredLength(header: string | string[] | undefined): number {
  const raw = Array.isArray(header) ? header[0] : header;
  if (raw === undefined || !/^\d+$/.test(raw)) throw new InvalidFileError('Send the file with its length.');
  const length = Number(raw);
  if (length > MAX_DIGITAL_FILE_BYTES) throw new FileTooBigError(FILE_MB);
  if (length === 0) throw new InvalidFileError('That file is empty.');
  return length;
}

/** `x-file-name`: URI-decoded, trimmed, path parts dropped, at most FILE_NAME_MAX characters (the extension is kept). */
export function cleanFileName(header: string | string[] | undefined): string {
  const raw = Array.isArray(header) ? header[0] : header;
  let decoded = raw ?? '';
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    throw new InvalidFileError('That file name could not be read.');
  }
  // eslint-disable-next-line no-control-regex
  const base = (decoded.split(/[\\/]/).pop() ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (base === '' || base === '.' || base === '..') throw new InvalidFileError('That file has no name.');
  const chars = [...base];
  if (chars.length <= FILE_NAME_MAX) return base;
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 && base.length - dot <= 12 ? base.slice(dot) : '';
  return [...base.slice(0, dot > 0 ? dot : base.length)].slice(0, FILE_NAME_MAX - [...ext].length).join('') + ext;
}

/** A pass-through that counts bytes and fails the stream at `max`, whatever the request claimed. */
export function limitBytes(max: number): Transform & { readonly bytes: number } {
  let seen = 0;
  const stream = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      seen += chunk.length;
      if (seen > max) done(new FileTooBigError(FILE_MB));
      else done(null, chunk);
    },
  });
  Object.defineProperty(stream, 'bytes', { get: () => seen });
  return stream as Transform & { readonly bytes: number };
}

/** Never reused, never chosen by a client. */
export function newFileKey(pageId: string, itemId: string): string {
  return `digital/${pageId}/${itemId}/${randomBytes(16).toString('hex')}`;
}

/** Cheap check before any bytes are taken: the item exists, delivers files, and has room. */
export async function checkFileRoom(prisma: PrismaClient, accountId: string, itemId: string): Promise<{ pageId: string }> {
  const item = await ownItem(prisma, accountId, itemId, 'FILES', 'files');
  const count = await prisma.itemFile.count({ where: { itemId } });
  if (count >= MAX_DIGITAL_FILES) throw new TooManyFilesError(MAX_DIGITAL_FILES);
  return { pageId: item.pageId };
}

/** Records an uploaded file under the item's lock, so two parallel uploads cannot make a sixth. */
export async function recordFile(
  prisma: PrismaClient,
  accountId: string,
  itemId: string,
  file: { key: string; name: string; sizeBytes: number; contentType: string },
): Promise<{ id: string; name: string; sizeBytes: number }> {
  return prisma.$transaction(async (tx) => {
    await lockItem(tx, itemId);
    await ownItem(tx, accountId, itemId, 'FILES', 'files');
    const existing = await tx.itemFile.aggregate({ where: { itemId }, _count: { _all: true }, _max: { position: true } });
    if (existing._count._all >= MAX_DIGITAL_FILES) throw new TooManyFilesError(MAX_DIGITAL_FILES);
    return tx.itemFile.create({
      data: { itemId, key: file.key, name: file.name, sizeBytes: file.sizeBytes, contentType: file.contentType, position: (existing._max.position ?? -1) + 1 },
      select: { id: true, name: true, sizeBytes: true },
    });
  });
}

/** Removes the file's row and returns its key, for the caller to delete the stored object. */
export async function removeFile(prisma: PrismaClient, accountId: string, itemId: string, fileId: string): Promise<string> {
  const page = await storePageFor(prisma, accountId);
  return prisma.$transaction(async (tx) => {
    const file = await tx.itemFile.findFirst({ where: { id: fileId, itemId, item: { pageId: page.id } }, select: { key: true } });
    if (!file) throw new FileNotFoundError();
    await tx.itemFile.delete({ where: { id: fileId } });
    return file.key;
  });
}

/** Best effort: the row is gone, so a stored object that will not delete is only wasted space. */
export async function removeStored(files: PrivateFiles, key: string, log: (err: string) => void): Promise<void> {
  await files.remove(key).catch((error: unknown) => log(error instanceof Error ? error.message : String(error)));
}

// ---- codes ----------------------------------------------------------------

const CODE_MAX = 200;
const CODES_PER_ITEM = 5000;

/** Adds the pasted codes the item does not already hold. `added` counts only new ones. */
export async function addCodes(prisma: PrismaClient, accountId: string, itemId: string, text: string): Promise<{ added: number; left: number }> {
  const codes = parseCodes(text);
  if (codes.some((code) => [...code].length > CODE_MAX)) throw new InvalidCodesError(`Each code can be up to ${CODE_MAX} characters.`);
  return prisma.$transaction(async (tx) => {
    await lockItem(tx, itemId);
    await ownItem(tx, accountId, itemId, 'CODES', 'codes');
    const total = await tx.itemCode.count({ where: { itemId } });
    if (total + codes.length > CODES_PER_ITEM) throw new InvalidCodesError(`An item holds at most ${CODES_PER_ITEM} codes.`);
    const created = codes.length === 0 ? { count: 0 } : await tx.itemCode.createMany({ data: codes.map((code) => ({ itemId, code })), skipDuplicates: true });
    const left = await tx.itemCode.count({ where: { itemId, orderLineId: null } });
    return { added: created.count, left };
  });
}

/** Only a code nobody has been given. */
export async function removeCode(prisma: PrismaClient, accountId: string, itemId: string, codeId: string): Promise<{ left: number }> {
  const page = await storePageFor(prisma, accountId);
  return prisma.$transaction(async (tx) => {
    await lockItem(tx, itemId);
    const code = await tx.itemCode.findFirst({ where: { id: codeId, itemId, item: { pageId: page.id } }, select: { orderLineId: true } });
    if (!code) throw new CodeNotFoundError();
    if (code.orderLineId !== null) throw new CodeUsedError();
    await tx.itemCode.delete({ where: { id: codeId } });
    return { left: await tx.itemCode.count({ where: { itemId, orderLineId: null } }) };
  });
}

// ---- sessions -------------------------------------------------------------

const SEATS_MAX = 10_000;
const SESSIONS_PER_ITEM = 100;
const SESSION_SELECT = { id: true, startsAt: true, seats: true, bookings: { select: { seats: true } } } as const;

function checkSeats(seats: number): number {
  if (!Number.isInteger(seats) || seats < 1 || seats > SEATS_MAX) throw new InvalidSessionError(`Seats must be a whole number from 1 to ${SEATS_MAX}.`);
  return seats;
}

function checkStart(startsAt: Date, now: Date): Date {
  if (Number.isNaN(startsAt.getTime())) throw new InvalidSessionError('Pick a date and time.');
  if (startsAt.getTime() <= now.getTime()) throw new InvalidSessionError('Pick a time in the future.');
  return startsAt;
}

export async function addSession(prisma: PrismaClient, accountId: string, itemId: string, input: { startsAt: Date; seats: number }, now = new Date()): Promise<SessionRow> {
  const startsAt = checkStart(input.startsAt, now);
  const seats = checkSeats(input.seats);
  return prisma.$transaction(async (tx) => {
    await lockItem(tx, itemId);
    await ownItem(tx, accountId, itemId, 'SESSION', 'a session');
    if ((await tx.itemSession.count({ where: { itemId } })) >= SESSIONS_PER_ITEM) throw new InvalidSessionError(`An item holds at most ${SESSIONS_PER_ITEM} times.`);
    return sessionRow(await tx.itemSession.create({ data: { itemId, startsAt, seats }, select: SESSION_SELECT }));
  });
}

export async function updateSession(
  prisma: PrismaClient,
  accountId: string,
  itemId: string,
  sessionId: string,
  input: { startsAt?: Date; seats?: number },
  now = new Date(),
): Promise<SessionRow> {
  const startsAt = input.startsAt === undefined ? undefined : checkStart(input.startsAt, now);
  const seats = input.seats === undefined ? undefined : checkSeats(input.seats);
  const page = await storePageFor(prisma, accountId);
  return prisma.$transaction(async (tx) => {
    // The session row is locked, so a booking made at this moment waits (or is waited for).
    const owned = await tx.itemSession.findFirst({ where: { id: sessionId, itemId, item: { pageId: page.id } }, select: { id: true } });
    if (!owned) throw new SessionNotFoundError();
    await tx.$queryRaw`SELECT id FROM "ItemSession" WHERE id = ${sessionId} FOR UPDATE`;
    if (seats !== undefined) {
      const booked = (await tx.sessionBooking.aggregate({ where: { sessionId }, _sum: { seats: true } }))._sum.seats ?? 0;
      if (seats < booked) throw new SeatsBookedError(booked);
    }
    return sessionRow(await tx.itemSession.update({ where: { id: sessionId }, data: { ...(startsAt && { startsAt }), ...(seats !== undefined && { seats }) }, select: SESSION_SELECT }));
  });
}

export async function removeSession(prisma: PrismaClient, accountId: string, itemId: string, sessionId: string): Promise<void> {
  const page = await storePageFor(prisma, accountId);
  await prisma.$transaction(async (tx) => {
    const owned = await tx.itemSession.findFirst({ where: { id: sessionId, itemId, item: { pageId: page.id } }, select: { id: true } });
    if (!owned) throw new SessionNotFoundError();
    await tx.$queryRaw`SELECT id FROM "ItemSession" WHERE id = ${sessionId} FOR UPDATE`;
    // The foreign key only objects at commit; refuse here, with a sentence.
    if ((await tx.sessionBooking.count({ where: { sessionId } })) > 0) throw new SessionBookedError();
    await tx.itemSession.delete({ where: { id: sessionId } });
  });
}

/** True when any of the item's times has a booking. Read inside the delete's transaction. */
export async function hasBookings(tx: Prisma.TransactionClient, itemId: string): Promise<boolean> {
  return (await tx.sessionBooking.count({ where: { session: { itemId } } })) > 0;
}
