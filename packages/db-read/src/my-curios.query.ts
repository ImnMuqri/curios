import { tidySocials, type SocialKind } from '@curios/core/socials';
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
  /** Social profiles to show as icons under the name, in display order. */
  socials: { kind: SocialKind; value: string }[];
  links: { id: string; label: string; url: string; size: TileSize | null }[];
  /** The shop tile, or null while the shop is closed. */
  shop: ShopTile | null;
  /**
   * The Shop tab's switch: whether the shop is open, and how many items are
   * up for sale either way. Null on a personal page, which has no shop.
   */
  shopTab: {
    open: boolean;
    itemCount: number;
    /** The first few, for the preview's Shop tab. */
    preview: { name: string; priceCents: number | null; photoKey: string | null }[];
  } | null;
}

/** How many items the preview's Shop tab shows. */
const SHOP_PREVIEW = 3;

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
      socials: true,
      links: { orderBy: { position: 'asc' }, select: { id: true, label: true, url: true, size: true } },
    },
  });
  if (!page) return null;
  const { mode: _mode, storeEnabled: _open, shopTilePosition: _at, shopTileSize: _size, items: _items, ...rest } = page;
  return {
    ...rest,
    socials: tidySocials(rest.socials),
    shop: shopTileOf(page),
    shopTab:
      page.mode === 'BUSINESS' ? { open: page.storeEnabled, itemCount: page.items.length, preview: page.items.slice(0, SHOP_PREVIEW) } : null,
  };
}

/**
 * Facts still waiting for review, for the sidebar's count. The review queue's
 * own filter (review.query.ts), so the number matches the screen it links to.
 */
export async function countPendingFacts(accountId: string): Promise<number> {
  return prismaRead.fact.count({ where: { page: { accountId }, verified: false, rejectedAt: null } });
}

export interface NavBadges {
  review: number;
  questions: number;
  leads: number;
  /** Orders with a receipt in, waiting for the owner to check it. */
  orders: number;
}

/**
 * The sidebar's counts, each the filter of the screen it sits beside: facts
 * waiting in Review, topics with no answer yet (Questions' "Needs you"), and
 * leads nobody has contacted (Leads' "New"), and orders whose receipt waits to be checked.
 */
export async function countNavBadges(accountId: string): Promise<NavBadges> {
  const [review, questions, leads, orders] = await Promise.all([
    countPendingFacts(accountId),
    prismaRead.topic.count({ where: { page: { accountId }, answer: null } }),
    prismaRead.lead.count({ where: { page: { accountId }, status: 'NEW' } }),
    prismaRead.order.count({ where: { page: { accountId }, status: 'PLACED', receiptUploadedAt: { not: null } } }),
  ]);
  return { review, questions, leads, orders };
}
