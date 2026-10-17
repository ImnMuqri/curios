import { tidySocials, type SocialKind } from '@curios/core/socials';
import type { FactCategory } from '@curios/core';
import type { HeadingFont, PageBackground, PageStyle, TileSize } from '@curios/core/bento';
import { prismaRead } from './client.js';
import { SHOP_TILE_SELECT, shopTileOf, type ShopTile } from './shop.query.js';

export interface PublicLink {
  id: string;
  label: string;
  url: string;
  icon: string | null;
  position: number;
  size: TileSize | null;
}

export interface PublicFact {
  id: string;
  category: FactCategory;
  claim: string;
  /** What the ask bar cycles. Null for any fact written before this column existed. */
  question: string | null;
}

export interface PublicPage {
  id: string;
  handle: string;
  displayName: string;
  bio: string | null;
  language: string;
  mode: 'PERSONAL' | 'BUSINESS';
  links: PublicLink[];
  facts: PublicFact[];
  /** Paid through this instant, or null. The capture gate's first input. */
  paidUntil: Date | null;
  /** Leads ever captured, for the free-trial half of the gate. */
  leadsCaptured: number;
  /** Whether this page, if personal, may appear in search results. See shouldIndex in @curios/core. */
  allowSearchIndexing: boolean;
  style: PageStyle;
  accentColor: string;
  headingFont: HeadingFont;
  /** The picture's object key, or null. apps/web turns it into a URL. */
  avatarKey: string | null;
  /** The cover: `stock/<name>` or a storage key; null is no cover. apps/web turns it into a URL. */
  coverKey: string | null;
  background: PageBackground;
  /** The owner's own colour, used when background is CUSTOM. */
  backgroundColor: string | null;
  /** Social profiles to show as icons under the name, in display order. */
  socials: { kind: SocialKind; value: string }[];
  /** The shop tile, or null while the shop is closed. */
  shop: ShopTile | null;
}

/**
 * Everything the public page renders, in one query.
 *
 * Only verified facts are ever exposed. An unreviewed price reaching a customer
 * is the single failure this product cannot recover from. Unpublished pages
 * are excluded outright: a draft is not reviewed yet, so nothing on it --
 * facts included -- is safe to show a visitor.
 */
export async function getPublicPage(handle: string): Promise<PublicPage | null> {
  const page = await prismaRead.page.findUnique({
    where: { handle: handle.toLowerCase(), published: true },
    select: {
      id: true,
      handle: true,
      displayName: true,
      bio: true,
      language: true,
      paidUntil: true,
      leadsCaptured: true,
      allowSearchIndexing: true,
      style: true,
      accentColor: true,
      headingFont: true,
      avatarKey: true,
      coverKey: true,
      background: true,
      backgroundColor: true,
      socials: true,
      ...SHOP_TILE_SELECT,
      links: {
        orderBy: { position: 'asc' },
        select: { id: true, label: true, url: true, icon: true, position: true, size: true },
      },
      facts: {
        where: { verified: true },
        orderBy: { createdAt: 'asc' },
        select: { id: true, category: true, claim: true, question: true },
      },
    },
  });

  if (!page) return null;
  const { storeEnabled: _open, shopTilePosition: _at, shopTileSize: _size, items: _items, ...rest } = page;
  return { ...rest, socials: tidySocials(rest.socials), shop: shopTileOf(page) };
}
