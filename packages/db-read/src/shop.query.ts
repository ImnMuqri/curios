import { PUBLIC_PAGE_WHERE } from '@curios/core';
import type { HeadingFont, PageBackground, PageStyle, TileSize } from '@curios/core/bento';
import { digitalFacts, seatsLeft, type DigitalFacts } from '@curios/core/digital';
import { itemChoicesOf, type ChoicesRow, type DeliveryMode, type ItemChoices } from '@curios/core/store';
import { prismaRead } from './client.js';

export interface ShopTile {
  position: number;
  size: TileSize | null;
  /** The shop's own name, or null for the page's word for "Shop". */
  name?: string | null;
  itemCount: number;
  /** The first available item's photo, for the tile's picture. */
  photoKey: string | null;
  /** The first three available items, for the shop pill's overlapping photos (the name gives an initial when there is no photo). */
  photos: { name: string; photoKey: string | null }[];
}

export interface ShopItem {
  id: string;
  name: string;
  /** The item's link word, frozen when it was created. */
  slug: string;
  description: string | null;
  category: string | null;
  tag: string | null;
  photoKey: string | null;
  /** On an Ask item, its starting price, or null for "Price on request". */
  priceCents: number | null;
  /**
   * An Ask item: an enquiry, never the basket (HANDOFF "Shop: Ask items", 8 Nov 2026). Always read here;
   * optional so a shelf built elsewhere (a test, the Store preview) reads as basket items when it leaves it out.
   */
  askForPrice?: boolean;
  /** What can be bought: with choice groups, the combinations that are on sale (the shop's, never the owner's off ones). */
  options: { id: string; label: string; priceCents: number }[];
  /** When the owner added it (ISO), for the shop's Latest / Earliest sort. Only the public shop read sets it. */
  createdAt?: string;
  /**
   * Choice groups inside the options ("Flavour" x "Size"): the groups, the choices (with the public square key of
   * their photo) and every combination, switched-off ones too, so the page can grey them. Absent on a plain item.
   */
  choices?: ItemChoices;
}

/**
 * An item as a visitor sees it: the shelf fields plus what a buyer is told of a digital
 * one (see digitalFacts). The link, the codes and the files themselves never leave here.
 */
export type PublicItem = ShopItem & DigitalFacts;

/** What an item is read with to know its choices and each combination's switch; see itemChoicesOf. */
const CHOICE_SELECT = {
  choiceGroupOne: true,
  choiceGroupTwo: true,
  choices: { orderBy: { position: 'asc' }, select: { id: true, group: true, label: true, position: true, photoId: true, photo: { select: { squareKey: true } } } },
} as const;

const OPTION_SELECT = { orderBy: { position: 'asc' }, select: { id: true, label: true, priceCents: true, available: true, choiceOneId: true, choiceTwoId: true } } as const;

/**
 * An item row as ShopItem has it: the options as {id, label, priceCents} (only the ones on sale when `onSaleOnly`,
 * which the shop passes and the owner's editor does not), and `choices` only when it has choice groups.
 */
function shaped<T extends ChoicesRow>(row: T, onSaleOnly: boolean): Omit<T, keyof ChoicesRow> & { options: ShopItem['options']; choices?: ItemChoices } {
  const { choiceGroupOne: _one, choiceGroupTwo: _two, choices: _choices, options, ...rest } = row;
  const choices = itemChoicesOf(row);
  return {
    ...rest,
    options: options.filter((o) => !onSaleOnly || o.available).map((o) => ({ id: o.id, label: o.label, priceCents: o.priceCents })),
    ...(choices ? { choices } : {}),
  };
}

const ITEM_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  category: true,
  tag: true,
  photoKey: true,
  priceCents: true,
  askForPrice: true,
  options: OPTION_SELECT,
  ...CHOICE_SELECT,
} as const;

const PUBLIC_ITEM_SELECT = {
  ...ITEM_SELECT,
  createdAt: true,
  kind: true,
  delivery: true,
  // Read only to know whether there is a link; stripped before the item leaves this file.
  accessUrl: true,
  sessionMinutes: true,
  sessionPlace: true,
  files: { orderBy: { position: 'asc' }, select: { name: true, contentType: true } },
  sessions: { select: { id: true, startsAt: true, seats: true, bookings: { select: { seats: true } } } },
  _count: { select: { codes: { where: { orderLineId: null } } } },
} as const;

/** The columns a tile is computed from, for page.query.ts and my-curios.query.ts to select. */
export const SHOP_TILE_SELECT = {
  mode: true,
  storeEnabled: true,
  shopTilePosition: true,
  shopTileSize: true,
  shopName: true,
  // Name and price as well, for the editor's preview of the shop.
  items: {
    where: { available: true },
    orderBy: { position: 'asc' },
    // Only what is on sale: this feeds the page's basket, which must not be able to hold a combination that is off.
    select: { id: true, photoKey: true, name: true, priceCents: true, options: { where: { available: true }, orderBy: { position: 'asc' }, select: { id: true, label: true, priceCents: true } } },
  },
} as const;

/** How many photos the shop pill overlaps. */
export const SHOP_PILL_PHOTOS = 3;

/**
 * The shop tile, or null when the page shows none: a closed shop, or a
 * personal page (which cannot open one, but a page switched back by hand in
 * psql must not grow a tile).
 */
export function shopTileOf(row: {
  mode: 'PERSONAL' | 'BUSINESS';
  storeEnabled: boolean;
  shopTilePosition: number;
  shopTileSize: TileSize | null;
  shopName?: string | null;
  items: { photoKey: string | null; name: string }[];
}): ShopTile | null {
  if (row.mode !== 'BUSINESS' || !row.storeEnabled) return null;
  return {
    position: row.shopTilePosition,
    size: row.shopTileSize,
    name: row.shopName ?? null,
    itemCount: row.items.length,
    photoKey: row.items.find((item) => item.photoKey !== null)?.photoKey ?? null,
    photos: row.items.slice(0, SHOP_PILL_PHOTOS).map((item) => ({ name: item.name, photoKey: item.photoKey })),
  };
}

export interface PublicShop {
  handle: string;
  displayName: string;
  /** The page's header is the same on every tab, bio included. */
  bio: string | null;
  language: string;
  style: PageStyle;
  accentColor: string;
  headingFont: HeadingFont;
  avatarKey: string | null;
  coverKey: string | null;
  /** An uploaded cover's colours at its top and foot (core's coverTintOf), for the phone's bars. */
  coverTop: string | null;
  coverBottom: string | null;
  background: PageBackground;
  backgroundColor: string | null;
  /** For the WhatsApp the basket is sent to. */
  links: { label: string; url: string }[];
  /** The shop's own name; null shows "Shop". */
  shopName: string | null;
  /** "About your shop", above the items. */
  shopDescription: string | null;
  /** The owner says the shop sells halal food. */
  shopHalal: boolean;
  pickupEnabled: boolean;
  /** Where to collect, in the owner's order; empty only on a page from before places (any time, no place). */
  pickupPlaces: PublicPickupPlace[];
  deliveryMode: DeliveryMode;
  deliveryFeeCents: number | null;
  minNoticeDays: number;
  /** Weekdays no order can be for, 0 = Sunday to 6 = Saturday. */
  closedDays: number[];
  deliveryNote: string | null;
  items: PublicItem[];
}

/** A pickup place as a customer sees it: its windows without their limits (the API says which are full on a day). */
export interface PublicPickupPlace {
  id: string;
  name: string;
  address: string;
  mapUrl: string | null;
  note: string | null;
  anyTime: boolean;
  windows: { id: string; from: number; to: number }[];
}

/**
 * Everything /handle/shop renders, or null when there is no shop to show.
 * Bank details and the QR are not here: nothing on this route takes payment
 * until slice 18's order page, which reads them for one order at a time.
 */
export async function getPublicShop(handle: string, now = new Date()): Promise<PublicShop | null> {
  const page = await prismaRead.page.findUnique({
    where: { handle: handle.toLowerCase(), ...PUBLIC_PAGE_WHERE },
    select: {
      id: true,
      mode: true,
      storeEnabled: true,
      handle: true,
      displayName: true,
      bio: true,
      language: true,
      style: true,
      accentColor: true,
      headingFont: true,
      avatarKey: true,
      coverKey: true,
      coverTop: true,
      coverBottom: true,
      background: true,
      backgroundColor: true,
      links: { orderBy: { position: 'asc' }, select: { label: true, url: true } },
      shopName: true,
      shopDescription: true,
      shopHalal: true,
      pickupEnabled: true,
      deliveryMode: true,
      deliveryFeeCents: true,
      minNoticeDays: true,
      closedDays: true,
      deliveryNote: true,
      items: { where: { available: true }, orderBy: { position: 'asc' }, select: PUBLIC_ITEM_SELECT },
    },
  });
  if (!page || page.mode !== 'BUSINESS' || !page.storeEnabled) return null;
  const { id: pageId, mode: _mode, storeEnabled: _open, items, ...shop } = page;
  const publicItems: PublicItem[] = items.map(({ files, sessions, _count, accessUrl, sessionMinutes, sessionPlace, kind, delivery, createdAt, ...item }) => ({
    ...shaped(item, true),
    createdAt: createdAt.toISOString(),
    ...digitalFacts(
      {
        kind,
        delivery,
        accessUrl,
        sessionMinutes,
        sessionPlace,
        files,
        codesLeft: _count.codes,
        sessions: sessions.map((t) => ({ id: t.id, startsAt: t.startsAt, seats: t.seats, booked: t.bookings.reduce((n, b) => n + b.seats, 0) })),
      },
      now,
    ),
  }));
  // With pickup off, no places: there is nowhere to collect from.
  const places = shop.pickupEnabled ? await getPickupPlaces(pageId) : [];
  const pickupPlaces = places.map(({ windows, ...place }) => ({ ...place, windows: windows.map(({ limit: _limit, ...w }) => w) }));
  return { ...shop, pickupPlaces, items: publicItems };
}

/**
 * An item as the owner's editor sees it. Files carry no key and codes no text: the editor
 * shows "N left", and a code is only ever shown to the buyer it was given to. Files, codes
 * and times appear only while the item is digital and set to deliver them.
 */
export interface OwnerPhoto {
  id: string;
  squareKey: string;
  width: number;
  height: number;
  frame: { x: number; y: number; size: number };
}

export interface OwnerItem extends ShopItem {
  /** The owner's own reference; read for the editor only, never for the shop. */
  sku: string | null;
  available: boolean;
  kind: 'PHYSICAL' | 'DIGITAL';
  delivery: 'FILES' | 'LINK' | 'CODES' | 'SESSION' | null;
  accessUrl: string | null;
  accessNote: string | null;
  sessionMinutes: number | null;
  sessionPlace: 'ONLINE' | 'IN_PERSON' | null;
  sessionWhere: string | null;
  /** The item's photos in order. The original's key is not selected: it is private. */
  photos: OwnerPhoto[];
  files: { id: string; name: string; sizeBytes: number }[];
  codesLeft: number;
  sessions: { id: string; startsAt: Date; seats: number; booked: number; seatsLeft: number }[];
}

/** The window the Store cards count over: "12 sold in 30 days". */
export const ITEM_STATS_DAYS = 30;

/**
 * What the Store's item cards say about an item, computed for the whole shelf at once.
 * `sold` is units on paid, not cancelled, orders paid in the last 30 days; `enquiries` the Ask
 * enquiries (leads that name the item) made in them; `seats` the next session still to run (or
 * running) of a session item, with the seats booked and its capacity. A count of 0 is 0: the screen shows nothing for it.
 */
export interface ItemStats {
  sold: number;
  enquiries: number;
  seats: { startsAt: Date; taken: number; total: number } | null;
}

export interface OwnerStore {
  mode: 'PERSONAL' | 'BUSINESS';
  settings: {
    enabled: boolean;
    shopName: string | null;
    shopDescription: string | null;
    shopHalal: boolean;
    pickupEnabled: boolean;
    pickupNote: string | null;
    deliveryMode: DeliveryMode;
    deliveryFeeCents: number | null;
    minNoticeDays: number;
    closedDays: number[];
    deliveryNote: string | null;
    paymentQrKey: string | null;
    bankName: string | null;
    bankAccountName: string | null;
    bankAccountNumber: string | null;
    tileSize: TileSize | null;
  };
  items: OwnerItem[];
  /** What each item has done lately, by item id: every item has an entry. See ItemStats. */
  itemStats: Record<string, ItemStats>;
  /**
   * The owner's own CHIP account, as Store -> Payment shows it. Never the key: it is
   * not selected here, and this role cannot read that column anyway (readonly-role.sql).
   */
  chip: { connected: boolean; brandName: string | null; methods: string[]; checkedAt: Date | null; isTest: boolean };
}

/** The owner's Store screen: every item, available or not, and the settings. */
export async function getOwnerStore(accountId: string, now: Date = new Date()): Promise<OwnerStore | null> {
  const page = await prismaRead.page.findUnique({
    where: { accountId },
    select: {
      mode: true,
      storeEnabled: true,
      shopName: true,
      shopDescription: true,
      shopHalal: true,
      pickupEnabled: true,
      pickupNote: true,
      deliveryMode: true,
      deliveryFeeCents: true,
      minNoticeDays: true,
      closedDays: true,
      deliveryNote: true,
      paymentQrKey: true,
      bankName: true,
      bankAccountName: true,
      bankAccountNumber: true,
      shopTileSize: true,
      items: {
        orderBy: { position: 'asc' },
        select: {
          ...ITEM_SELECT,
          sku: true,
          available: true,
          kind: true,
          delivery: true,
          accessUrl: true,
          accessNote: true,
          sessionMinutes: true,
          sessionPlace: true,
          sessionWhere: true,
          photos: { orderBy: { position: 'asc' }, select: { id: true, squareKey: true, width: true, height: true, frameX: true, frameY: true, frameSize: true } },
          files: { orderBy: { position: 'asc' }, select: { id: true, name: true, sizeBytes: true } },
          sessions: { orderBy: { startsAt: 'asc' }, select: { id: true, startsAt: true, seats: true, bookings: { select: { seats: true } } } },
          _count: { select: { codes: { where: { orderLineId: null } } } },
        },
      },
      paymentAccount: { select: { brandName: true, methods: true, checkedAt: true, isTest: true } },
    },
  });
  if (!page) return null;
  const { mode, items, storeEnabled, shopTileSize, paymentAccount, ...rest } = page;
  const chip = paymentAccount
    ? { connected: true, ...paymentAccount }
    : { connected: false, brandName: null, methods: [], checkedAt: null, isTest: false };
  const ownerItems: OwnerItem[] = items.map(({ photos, files, sessions, _count, ...raw }) => {
    const item = shaped(raw, false);
    const on = (delivery: OwnerItem['delivery']) => item.kind === 'DIGITAL' && item.delivery === delivery;
    return {
      ...item,
      photos: photos.map((p) => ({ id: p.id, squareKey: p.squareKey, width: p.width, height: p.height, frame: { x: p.frameX, y: p.frameY, size: p.frameSize } })),
      files: on('FILES') ? files : [],
      codesLeft: on('CODES') ? _count.codes : 0,
      sessions: on('SESSION')
        ? sessions.map((s) => {
            const booked = s.bookings.reduce((sum, b) => sum + b.seats, 0);
            return { id: s.id, startsAt: s.startsAt, seats: s.seats, booked, seatsLeft: seatsLeft(s, booked) };
          })
        : [],
    };
  });
  const itemStats = await getItemStats(ownerItems, now);
  return { mode, items: ownerItems, itemStats, settings: { enabled: storeEnabled, tileSize: shopTileSize, ...rest }, chip };
}

/** Two grouped reads for the whole shelf (never one per item), and the seats from the sessions already loaded. */
async function getItemStats(items: OwnerItem[], now: Date): Promise<Record<string, ItemStats>> {
  const ids = items.map((item) => item.id);
  const since = new Date(now.getTime() - ITEM_STATS_DAYS * 24 * 60 * 60 * 1000);
  const [sold, asked] = ids.length
    ? await Promise.all([
        prismaRead.orderLine.groupBy({
          by: ['itemId'],
          where: { itemId: { in: ids }, order: { status: { in: ['PAID', 'COMPLETED'] }, paidAt: { gte: since, lte: now } } },
          _sum: { quantity: true },
        }),
        prismaRead.lead.groupBy({ by: ['itemId'], where: { itemId: { in: ids }, createdAt: { gte: since, lte: now } }, _count: { _all: true } }),
      ])
    : [[], []];
  const soldBy = new Map(sold.map((row) => [row.itemId, row._sum.quantity ?? 0]));
  const askedBy = new Map(asked.map((row) => [row.itemId, row._count._all]));
  return Object.fromEntries(
    items.map((item) => {
      // The next time that has not finished: sessions come soonest first.
      const next = item.sessions.find((s) => s.startsAt.getTime() + (item.sessionMinutes ?? 0) * 60_000 >= now.getTime());
      return [
        item.id,
        {
          sold: soldBy.get(item.id) ?? 0,
          enquiries: askedBy.get(item.id) ?? 0,
          seats: next ? { startsAt: next.startsAt, taken: next.booked, total: next.seats } : null,
        },
      ];
    }),
  );
}

/** One of the owner's pickup places, with its times in minutes after midnight (Malaysia time). */
export interface OwnerPickupPlace {
  id: string;
  name: string;
  address: string;
  mapUrl: string | null;
  note: string | null;
  anyTime: boolean;
  windows: { id: string; from: number; to: number; limit: number | null }[];
}

/** A shop's pickup places in the owner's order, each with its windows in theirs. */
export async function getPickupPlaces(pageId: string): Promise<OwnerPickupPlace[]> {
  const rows = await prismaRead.pickupPlace.findMany({
    where: { pageId },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      name: true,
      address: true,
      mapUrl: true,
      note: true,
      anyTime: true,
      windows: { orderBy: [{ position: 'asc' }, { id: 'asc' }], select: { id: true, fromMinute: true, toMinute: true, limit: true } },
    },
  });
  return rows.map(({ windows, ...place }) => ({
    ...place,
    windows: windows.map((w) => ({ id: w.id, from: w.fromMinute, to: w.toMinute, limit: w.limit })),
  }));
}
