import { PUBLIC_PAGE_WHERE } from '@curios/core';
import type { HeadingFont, PageBackground, PageStyle, TileSize } from '@curios/core/bento';
import { digitalFacts, seatsLeft, type DigitalFacts } from '@curios/core/digital';
import type { DeliveryMode } from '@curios/core/store';
import { prismaRead } from './client.js';

export interface ShopTile {
  position: number;
  size: TileSize | null;
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
  priceCents: number | null;
  options: { id: string; label: string; priceCents: number }[];
}

/**
 * An item as a visitor sees it: the shelf fields plus what a buyer is told of a digital
 * one (see digitalFacts). The link, the codes and the files themselves never leave here.
 */
export type PublicItem = ShopItem & DigitalFacts;

const ITEM_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  category: true,
  tag: true,
  photoKey: true,
  priceCents: true,
  options: { orderBy: { position: 'asc' }, select: { id: true, label: true, priceCents: true } },
} as const;

const PUBLIC_ITEM_SELECT = {
  ...ITEM_SELECT,
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
  // Name and price as well, for the editor's preview of the shop.
  items: {
    where: { available: true },
    orderBy: { position: 'asc' },
    select: { id: true, photoKey: true, name: true, priceCents: true, options: { orderBy: { position: 'asc' }, select: { id: true, label: true, priceCents: true } } },
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
  items: { photoKey: string | null; name: string }[];
}): ShopTile | null {
  if (row.mode !== 'BUSINESS' || !row.storeEnabled) return null;
  return {
    position: row.shopTilePosition,
    size: row.shopTileSize,
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
  /** "About your shop", above the items. */
  shopDescription: string | null;
  /** The owner says the shop sells halal food. */
  shopHalal: boolean;
  pickupEnabled: boolean;
  pickupNote: string | null;
  deliveryMode: DeliveryMode;
  deliveryFeeCents: number | null;
  minNoticeDays: number;
  /** Weekdays no order can be for, 0 = Sunday to 6 = Saturday. */
  closedDays: number[];
  deliveryNote: string | null;
  items: PublicItem[];
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
      shopDescription: true,
      shopHalal: true,
      pickupEnabled: true,
      pickupNote: true,
      deliveryMode: true,
      deliveryFeeCents: true,
      minNoticeDays: true,
      closedDays: true,
      deliveryNote: true,
      items: { where: { available: true }, orderBy: { position: 'asc' }, select: PUBLIC_ITEM_SELECT },
    },
  });
  if (!page || page.mode !== 'BUSINESS' || !page.storeEnabled) return null;
  const { mode: _mode, storeEnabled: _open, items, ...shop } = page;
  const publicItems: PublicItem[] = items.map(({ files, sessions, _count, accessUrl, sessionMinutes, sessionPlace, kind, delivery, ...item }) => ({
    ...item,
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
  return { ...shop, items: publicItems };
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

export interface OwnerStore {
  mode: 'PERSONAL' | 'BUSINESS';
  settings: {
    enabled: boolean;
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
  /**
   * The owner's own CHIP account, as Store -> Payment shows it. Never the key: it is
   * not selected here, and this role cannot read that column anyway (readonly-role.sql).
   */
  chip: { connected: boolean; brandName: string | null; methods: string[]; checkedAt: Date | null; isTest: boolean };
}

/** The owner's Store screen: every item, available or not, and the settings. */
export async function getOwnerStore(accountId: string): Promise<OwnerStore | null> {
  const page = await prismaRead.page.findUnique({
    where: { accountId },
    select: {
      mode: true,
      storeEnabled: true,
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
  const ownerItems: OwnerItem[] = items.map(({ photos, files, sessions, _count, ...item }) => {
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
  return { mode, items: ownerItems, settings: { enabled: storeEnabled, tileSize: shopTileSize, ...rest }, chip };
}
