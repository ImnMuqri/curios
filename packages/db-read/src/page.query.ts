import { canTakeOrders, PUBLIC_PAGE_WHERE } from '@curios/core';
import type { DeliveryMode } from '@curios/core/store';
import { isPictureProvider, type LinkKind, type PictureMode, type WidgetProvider } from '@curios/core/widgets';
import type { VoucherTerms } from '@curios/core/vouchers';
import { tidySocials, type SocialKind } from '@curios/core/socials';
import type { FactCategory } from '@curios/core';
import { pageEntries } from '@curios/core/bento';
import type { AvatarSize, CoverLayout, HeadingFont, PageBackground, PageLayout, PageStyle, TileSize } from '@curios/core/bento';
import { prismaRead } from './client.js';
import { getSettings } from './settings.query.js';
import { SHOP_TILE_SELECT, shopTileOf, type ShopTile } from './shop.query.js';
import { getLiveAutoVouchers } from './vouchers.query.js';

export interface PublicLink {
  id: string;
  label: string;
  url: string;
  icon: string | null;
  position: number;
  size: TileSize | null;
  kind: LinkKind;
  provider: WidgetProvider | null;
  embedRef: string | null;
  embedTitle: string | null;
  embedImage: string | null;
  /** CAROUSEL, GRID, FULL or SQUARE on a Pictures or GIF widget; null on every other row. */
  pictureMode: PictureMode | null;
  /** The description for screen readers of a Pictures or GIF widget. */
  altText: string | null;
  /** A Pictures or GIF widget's pictures in order, never empty on a widget that is returned; empty on every other row. */
  pictures: PublicLinkPicture[];
}

/** One picture of a widget. `key` is a public-store key; apps/web turns it into a URL. A GIF's contentType is image/gif. */
export interface PublicLinkPicture {
  key: string;
  contentType: string;
  width: number;
  height: number;
  position: number;
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
  /** The buttons' edge and shadow; null is the page's text colour. */
  secondaryColor: string | null;
  headingFont: HeadingFont;
  /** The picture's object key, or null. apps/web turns it into a URL. */
  avatarKey: string | null;
  /** The picture's size and whether it wears its ring (Medium with the ring is how every page began). */
  avatarSize: AvatarSize;
  avatarBorder: boolean;
  /** The cover: `stock/<name>` or a storage key; null is no cover. apps/web turns it into a URL. */
  coverKey: string | null;
  /** Top is the cover as a band at the head of the page; Full fills the page behind the content. */
  coverLayout: CoverLayout;
  /** Full page only: the page colour over the photo (true) or the photo as it is. */
  coverWash: boolean;
  /** A column of links, or a bento grid. */
  layout: PageLayout;
  background: PageBackground;
  /** The owner's own colour, used when background is CUSTOM. */
  backgroundColor: string | null;
  /** Social profiles to show as icons under the name, in display order. */
  socials: { kind: SocialKind; value: string }[];
  /** Where "People often ask" sits among the links (an index into the whole page); null is after the last. */
  faqPosition: number | null;
  /** The shop tile, or null while the shop is closed. */
  shop: ShopTile | null;
  /**
   * What the shop pill and the basket bar need that the tile does not: the
   * next pickup day's inputs, whether orders can be taken, and the shelf's
   * prices to price a saved basket, and the live automatic vouchers the
   * basket takes off (none while orders are paused: a paused shop honours
   * no voucher). Null while the shop is closed.
   */
  shopOrdering: {
    pickupEnabled: boolean;
    deliveryMode: DeliveryMode;
    minNoticeDays: number;
    closedDays: number[];
    canTakeOrders: boolean;
    items: { id: string; name: string; priceCents: number | null; options: { id: string; label: string; priceCents: number }[] }[];
    vouchers: VoucherTerms[];
  } | null;
}

export type PageStatus = 'live' | 'suspended' | 'missing';

/**
 * What a visitor should be told about an address: live, suspended by the
 * Curios team (the routes show the unavailable page, not a 404), or missing
 * (never claimed, or not published yet -- a draft is not announced). Carries
 * the page's language so the unavailable page can speak it.
 */
export async function getPageStatus(handle: string): Promise<PageStatus> {
  return (await getPageAvailability(handle)).status;
}

export async function getPageAvailability(handle: string): Promise<{ status: PageStatus; language: 'en' | 'ms' }> {
  const page = await prismaRead.page.findUnique({
    where: { handle: handle.toLowerCase() },
    select: { published: true, suspendedAt: true, language: true },
  });
  const language = page?.language === 'ms' ? 'ms' : 'en';
  if (!page || !page.published) return { status: 'missing', language };
  return { status: page.suspendedAt === null ? 'live' : 'suspended', language };
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
    where: { handle: handle.toLowerCase(), ...PUBLIC_PAGE_WHERE },
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
      secondaryColor: true,
      headingFont: true,
      avatarKey: true,
      avatarSize: true,
      avatarBorder: true,
      coverKey: true,
      coverLayout: true,
      coverWash: true,
      layout: true,
      background: true,
      backgroundColor: true,
      socials: true,
      ordersPlaced: true,
      ordersAtTrialReset: true,
      pickupEnabled: true,
      deliveryMode: true,
      minNoticeDays: true,
      closedDays: true,
      ...SHOP_TILE_SELECT,
      faqPosition: true,
      links: {
        orderBy: { position: 'asc' },
        select: { id: true, label: true, url: true, icon: true, position: true, size: true, kind: true, provider: true, embedRef: true, embedTitle: true, embedImage: true, pictureMode: true, altText: true, pictures: { orderBy: { position: 'asc' }, select: { key: true, contentType: true, width: true, height: true, position: true } } },
      },
      facts: {
        where: { verified: true },
        orderBy: { createdAt: 'asc' },
        select: { id: true, category: true, claim: true, question: true },
      },
    },
  });

  if (!page) return null;
  // The shop's free orders are the admin's allowance, as checkout counts them.
  const { freeOrders } = await getSettings();
  const {
    storeEnabled: _open,
    shopTilePosition: _at,
    shopTileSize: _size,
    items,
    ordersPlaced,
    ordersAtTrialReset,
    pickupEnabled,
    deliveryMode,
    minNoticeDays,
    closedDays,
    ...rest
  } = page;
  const shop = shopTileOf(page);
  // A Pictures or GIF widget with no pictures is not shown. Dropping it shifts the full list, so the shop and FAQ
  // positions (indexes into the finished list) are read back from the list as it stands without it.
  const empty = new Set(page.links.filter((l) => isPictureProvider(l.provider) && l.pictures.length === 0).map((l) => l.id));
  const shown = empty.size === 0 ? rest.links : rest.links.filter((l) => !empty.has(l.id));
  let faqPosition = rest.faqPosition;
  if (empty.size > 0) {
    const entries = pageEntries(page.links, shop ? { position: shop.position, size: shop.size } : null, { position: rest.faqPosition ?? null }).filter((e) => e.kind !== 'link' || !empty.has(e.id));
    if (shop) shop.position = entries.findIndex((e) => e.kind === 'shop');
    if (rest.faqPosition !== null) faqPosition = entries.findIndex((e) => e.kind === 'faq');
  }
  const now = new Date();
  const takesOrders = canTakeOrders({ mode: page.mode, paidUntil: page.paidUntil, ordersPlaced, ordersAtTrialReset, now }, freeOrders);
  return {
    ...rest,
    links: shown,
    faqPosition,
    socials: tidySocials(rest.socials),
    shop,
    shopOrdering: shop
      ? {
          pickupEnabled,
          deliveryMode,
          minNoticeDays,
          closedDays,
          canTakeOrders: takesOrders,
          items: items.map(({ id, name, priceCents, options }) => ({ id, name, priceCents, options })),
          vouchers: takesOrders ? await getLiveAutoVouchers(page.id, now) : [],
        }
      : null,
  };
}
