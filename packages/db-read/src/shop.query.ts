import type { HeadingFont, PageBackground, PageStyle, TileSize } from '@curios/core/bento';
import type { DeliveryMode } from '@curios/core/store';
import { prismaRead } from './client.js';

export interface ShopTile {
  position: number;
  size: TileSize | null;
  itemCount: number;
  /** The first available item's photo, for the tile's picture. */
  photoKey: string | null;
}

export interface ShopItem {
  id: string;
  name: string;
  description: string | null;
  photoKey: string | null;
  priceCents: number | null;
  options: { id: string; label: string; priceCents: number }[];
}

const ITEM_SELECT = {
  id: true,
  name: true,
  description: true,
  photoKey: true,
  priceCents: true,
  options: { orderBy: { position: 'asc' }, select: { id: true, label: true, priceCents: true } },
} as const;

/** The columns a tile is computed from, for page.query.ts and my-curios.query.ts to select. */
export const SHOP_TILE_SELECT = {
  mode: true,
  storeEnabled: true,
  shopTilePosition: true,
  shopTileSize: true,
  // Name and price as well, for the editor's preview of the Shop tab.
  items: { where: { available: true }, orderBy: { position: 'asc' }, select: { photoKey: true, name: true, priceCents: true } },
} as const;

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
  items: { photoKey: string | null }[];
}): ShopTile | null {
  if (row.mode !== 'BUSINESS' || !row.storeEnabled) return null;
  return {
    position: row.shopTilePosition,
    size: row.shopTileSize,
    itemCount: row.items.length,
    photoKey: row.items.find((item) => item.photoKey !== null)?.photoKey ?? null,
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
  background: PageBackground;
  backgroundColor: string | null;
  /** For the WhatsApp the basket is sent to. */
  links: { label: string; url: string }[];
  /** "About your shop", above the items. */
  shopDescription: string | null;
  pickupEnabled: boolean;
  pickupNote: string | null;
  deliveryMode: DeliveryMode;
  deliveryFeeCents: number | null;
  minNoticeDays: number;
  /** Weekdays no order can be for, 0 = Sunday to 6 = Saturday. */
  closedDays: number[];
  deliveryNote: string | null;
  items: ShopItem[];
}

/**
 * Everything /handle/shop renders, or null when there is no shop to show.
 * Bank details and the QR are not here: nothing on this route takes payment
 * until slice 18's order page, which reads them for one order at a time.
 */
export async function getPublicShop(handle: string): Promise<PublicShop | null> {
  const page = await prismaRead.page.findUnique({
    where: { handle: handle.toLowerCase(), published: true },
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
      background: true,
      backgroundColor: true,
      links: { orderBy: { position: 'asc' }, select: { label: true, url: true } },
      shopDescription: true,
      pickupEnabled: true,
      pickupNote: true,
      deliveryMode: true,
      deliveryFeeCents: true,
      minNoticeDays: true,
      closedDays: true,
      deliveryNote: true,
      items: { where: { available: true }, orderBy: { position: 'asc' }, select: ITEM_SELECT },
    },
  });
  if (!page || page.mode !== 'BUSINESS' || !page.storeEnabled) return null;
  const { mode: _mode, storeEnabled: _open, ...shop } = page;
  return shop;
}

export interface OwnerStore {
  mode: 'PERSONAL' | 'BUSINESS';
  settings: {
    enabled: boolean;
    shopDescription: string | null;
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
  items: (ShopItem & { available: boolean })[];
}

/** The owner's Store screen: every item, available or not, and the settings. */
export async function getOwnerStore(accountId: string): Promise<OwnerStore | null> {
  const page = await prismaRead.page.findUnique({
    where: { accountId },
    select: {
      mode: true,
      storeEnabled: true,
      shopDescription: true,
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
      items: { orderBy: { position: 'asc' }, select: { ...ITEM_SELECT, available: true } },
    },
  });
  if (!page) return null;
  const { mode, items, storeEnabled, shopTileSize, ...rest } = page;
  return { mode, items, settings: { enabled: storeEnabled, tileSize: shopTileSize, ...rest } };
}
