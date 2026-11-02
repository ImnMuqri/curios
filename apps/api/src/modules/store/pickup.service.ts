import type { Prisma, PrismaClient } from '@curios/db';
import {
  PICKUP_ADDRESS_MAX,
  PICKUP_NOTE_MAX,
  PICKUP_PLACE_NAME_MAX,
  PICKUP_PLACES_MAX,
  PICKUP_WINDOWS_MAX,
  windowProblem,
} from '@curios/core/pickup';
import {
  PickupLastPlaceError,
  PickupPlaceInvalidError,
  PickupPlaceNotFoundError,
  PickupPlacesFullError,
} from './store.errors.js';
import { storePageFor } from './store-page.js';

export type PlaceInput = {
  name: string;
  address: string;
  mapUrl: string | null;
  note: string | null;
  anyTime: boolean;
  /** A window with an `id` is that window of this place, updated in place; one without is new. */
  windows: { id?: string; from: number; to: number; limit: number | null }[];
};

export type PickupPlaceView = {
  id: string;
  name: string;
  address: string;
  mapUrl: string | null;
  note: string | null;
  anyTime: boolean;
  windows: { id: string; from: number; to: number; limit: number | null }[];
};

const SELECT = {
  id: true,
  name: true,
  address: true,
  mapUrl: true,
  note: true,
  anyTime: true,
  windows: { orderBy: { position: 'asc' }, select: { id: true, fromMinute: true, toMinute: true, limit: true } },
} as const satisfies Prisma.PickupPlaceSelect;

type Row = Prisma.PickupPlaceGetPayload<{ select: typeof SELECT }>;

function toView(row: Row): PickupPlaceView {
  return {
    ...row,
    windows: row.windows.map((w) => ({ id: w.id, from: w.fromMinute, to: w.toMinute, limit: w.limit })),
  };
}

async function listFor(db: Pick<Prisma.TransactionClient, 'pickupPlace'>, pageId: string): Promise<PickupPlaceView[]> {
  const rows = await db.pickupPlace.findMany({ where: { pageId }, orderBy: [{ position: 'asc' }, { id: 'asc' }], select: SELECT });
  return rows.map(toView);
}

/** The place's fields as they are stored, or the plain sentence for the first one that fails. */
function judge(input: PlaceInput) {
  const name = input.name.trim();
  if (name === '' || name.length > PICKUP_PLACE_NAME_MAX) {
    throw new PickupPlaceInvalidError(`A place name is 1 to ${PICKUP_PLACE_NAME_MAX} characters.`);
  }
  const address = input.address.trim();
  if (address === '' || address.length > PICKUP_ADDRESS_MAX) {
    throw new PickupPlaceInvalidError(`An address is 1 to ${PICKUP_ADDRESS_MAX} characters.`);
  }
  const note = input.note?.trim() || null;
  if (note !== null && note.length > PICKUP_NOTE_MAX) {
    throw new PickupPlaceInvalidError(`A note is up to ${PICKUP_NOTE_MAX} characters.`);
  }
  const mapUrl = input.mapUrl?.trim() || null;
  if (mapUrl !== null) {
    let protocol = '';
    try {
      protocol = new URL(mapUrl).protocol;
    } catch {
      // Not a URL at all: refused below with the same sentence.
    }
    if (protocol !== 'https:') throw new PickupPlaceInvalidError('A map link starts with https://.');
  }
  // Any time that day has no windows: whatever was sent with it is dropped, not stored.
  const windows = input.anyTime ? [] : input.windows;
  if (!input.anyTime) {
    if (windows.length === 0) throw new PickupPlaceInvalidError('Add a pickup time, or choose any time that day.');
    if (windows.length > PICKUP_WINDOWS_MAX) {
      throw new PickupPlaceInvalidError(`A place has up to ${PICKUP_WINDOWS_MAX} pickup times.`);
    }
    const problem = windowProblem(windows);
    if (problem) throw new PickupPlaceInvalidError(problem);
  }
  return { name, address, note, mapUrl, anyTime: input.anyTime, windows };
}

/** Serialises writes to one shop's places, so the count and the order cannot race. */
async function lockPage(tx: Prisma.TransactionClient, pageId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Page" WHERE id = ${pageId} FOR UPDATE`;
}

export async function listPickupPlaces(prisma: PrismaClient, accountId: string): Promise<PickupPlaceView[]> {
  const page = await storePageFor(prisma, accountId);
  return listFor(prisma, page.id);
}

export async function addPickupPlace(prisma: PrismaClient, accountId: string, input: PlaceInput): Promise<PickupPlaceView[]> {
  const page = await storePageFor(prisma, accountId);
  const { windows, ...fields } = judge(input);
  if (windows.some((w) => w.id !== undefined)) throw new PickupPlaceInvalidError('A new place has no pickup times to keep yet.');
  return prisma.$transaction(async (tx) => {
    await lockPage(tx, page.id);
    const count = await tx.pickupPlace.count({ where: { pageId: page.id } });
    if (count >= PICKUP_PLACES_MAX) throw new PickupPlacesFullError();
    await tx.pickupPlace.create({
      data: {
        pageId: page.id,
        ...fields,
        position: count,
        windows: { create: windows.map((w, position) => ({ fromMinute: w.from, toMinute: w.to, limit: w.limit, position })) },
      },
    });
    return listFor(tx, page.id);
  });
}

/**
 * Replaces a place's fields and windows. A window sent with its `id` is updated in place, so the
 * orders on it stay; one not sent is deleted, and the foreign key nulls its orders' `pickupWindowId`
 * (they keep their snapshot of the times); one without an `id` is new.
 */
export async function updatePickupPlace(
  prisma: PrismaClient,
  accountId: string,
  id: string,
  input: PlaceInput,
): Promise<PickupPlaceView[]> {
  const page = await storePageFor(prisma, accountId);
  const { windows, ...fields } = judge(input);
  return prisma.$transaction(async (tx) => {
    await lockPage(tx, page.id);
    const stored = await tx.pickupPlace.findFirst({
      where: { id, pageId: page.id },
      select: { id: true, windows: { select: { id: true } } },
    });
    if (!stored) throw new PickupPlaceNotFoundError();
    const mine = new Set(stored.windows.map((w) => w.id));
    const sent = windows.flatMap((w) => (w.id === undefined ? [] : [w.id]));
    if (new Set(sent).size !== sent.length || sent.some((windowId) => !mine.has(windowId))) {
      throw new PickupPlaceInvalidError('One of those pickup times is not on this place. Reload and try again.');
    }
    await tx.pickupPlace.update({ where: { id }, data: fields });
    await tx.pickupWindow.deleteMany({ where: { placeId: id, id: { notIn: sent } } });
    for (const [position, w] of windows.entries()) {
      const data = { fromMinute: w.from, toMinute: w.to, limit: w.limit, position };
      if (w.id === undefined) await tx.pickupWindow.create({ data: { placeId: id, ...data } });
      else await tx.pickupWindow.update({ where: { id: w.id }, data });
    }
    return listFor(tx, page.id);
  });
}

/** Orders that used it keep their snapshot: the foreign keys set their `pickupPlaceId` and `pickupWindowId` to null. */
export async function removePickupPlace(prisma: PrismaClient, accountId: string, id: string): Promise<PickupPlaceView[]> {
  const page = await storePageFor(prisma, accountId);
  return prisma.$transaction(async (tx) => {
    await lockPage(tx, page.id);
    const places = await tx.pickupPlace.findMany({
      where: { pageId: page.id },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    if (!places.some((p) => p.id === id)) throw new PickupPlaceNotFoundError();
    const { pickupEnabled } = await tx.page.findUniqueOrThrow({ where: { id: page.id }, select: { pickupEnabled: true } });
    if (pickupEnabled && places.length === 1) throw new PickupLastPlaceError();
    await tx.pickupPlace.delete({ where: { id } });
    // Close the gap, so positions stay 0..n-1.
    for (const [position, p] of places.filter((p) => p.id !== id).entries()) {
      await tx.pickupPlace.update({ where: { id: p.id }, data: { position } });
    }
    return listFor(tx, page.id);
  });
}

export async function reorderPickupPlaces(prisma: PrismaClient, accountId: string, ids: string[]): Promise<PickupPlaceView[]> {
  const page = await storePageFor(prisma, accountId);
  return prisma.$transaction(async (tx) => {
    await lockPage(tx, page.id);
    const current = await tx.pickupPlace.findMany({ where: { pageId: page.id }, select: { id: true } });
    const known = new Set(current.map((p) => p.id));
    const sent = new Set(ids);
    if (sent.size !== ids.length || sent.size !== known.size || ids.some((id) => !known.has(id))) {
      throw new PickupPlaceInvalidError('Your pickup places changed somewhere else. Reload to see the latest, then try again.');
    }
    for (const [position, id] of ids.entries()) await tx.pickupPlace.update({ where: { id }, data: { position } });
    return listFor(tx, page.id);
  });
}
