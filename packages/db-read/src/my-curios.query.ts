import type { HeadingFont, PageBackground, PageStyle, TileSize } from '@curios/core/bento';
import { prismaRead } from './client.js';
import { SHOP_TILE_SELECT, shopTileOf, type ShopTile } from './shop.query.js';

export interface MyCurios {
  id: string;
  handle: string;
  displayName: string;
  bio: string | null;
  language: string;
  style: PageStyle;
  accentColor: string;
  headingFont: HeadingFont;
  avatarKey: string | null;
  /** `stock/<name>` or a storage key; null is no cover. */
  coverKey: string | null;
  background: PageBackground;
  /** The owner's own colour, used when background is CUSTOM. */
  backgroundColor: string | null;
  links: { id: string; label: string; url: string; size: TileSize | null }[];
  /** The shop tile, or null while the shop is closed. */
  shop: ShopTile | null;
}

/** Everything the My Curios editor starts from, in one query. */
export async function getMyCurios(accountId: string): Promise<MyCurios | null> {
  const page = await prismaRead.page.findUnique({
    where: { accountId },
    select: {
      id: true,
      handle: true,
      displayName: true,
      bio: true,
      language: true,
      ...SHOP_TILE_SELECT,
      style: true,
      accentColor: true,
      headingFont: true,
      avatarKey: true,
      coverKey: true,
      background: true,
      backgroundColor: true,
      links: { orderBy: { position: 'asc' }, select: { id: true, label: true, url: true, size: true } },
    },
  });
  if (!page) return null;
  const { mode: _mode, storeEnabled: _open, shopTilePosition: _at, shopTileSize: _size, items: _items, ...rest } = page;
  return { ...rest, shop: shopTileOf(page) };
}

/**
 * Facts still waiting for review, for the sidebar's count. The review queue's
 * own filter (review.query.ts), so the number matches the screen it links to.
 */
export async function countPendingFacts(accountId: string): Promise<number> {
  return prismaRead.fact.count({ where: { page: { accountId }, verified: false, rejectedAt: null } });
}
