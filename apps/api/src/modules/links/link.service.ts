import type { Prisma, PrismaClient, PictureMode as DbPictureMode, WidgetProvider as DbWidgetProvider } from '@curios/db';
import { charCount, LABEL_MAX, MAX_LINKS, normalizeLinkUrl, FAQ_TILE_ID, SHOP_TILE_ID, positionsAfterAdd, type TileSize } from '@curios/core/bento';
import { ALT_TEXT_MAX, hasCard, isPictureProvider, MODES_FOR, parseWidgetLink, PICTURE_PROVIDERS, WIDGET_NAMES, type PictureMode, type PictureProvider } from '@curios/core/widgets';
import { NoPageError } from '../pages/page.service.js';
import type { FetchWidgetCard } from './widget-card.js';

export class InvalidLinkError extends Error {
  readonly statusCode = 400;
  readonly code = 'INVALID_LINK';
  constructor(message: string) {
    super(message);
    this.name = 'InvalidLinkError';
  }
}

export class InvalidWidgetError extends Error {
  readonly statusCode = 400;
  readonly code = 'INVALID_WIDGET';
  constructor(message: string) {
    super(message);
    this.name = 'InvalidWidgetError';
  }
}

export class LinkLimitError extends Error {
  readonly statusCode = 400;
  readonly code = 'LINK_LIMIT';
  constructor() {
    super(`A page holds at most ${MAX_LINKS} links. Remove one to add another.`);
    this.name = 'LinkLimitError';
  }
}

export class LinkNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
  constructor() {
    super('No such link.');
    this.name = 'LinkNotFoundError';
  }
}

/** Another tab changed the list after this one loaded it. */
export class LinkOrderStaleError extends Error {
  readonly statusCode = 409;
  readonly code = 'LINK_ORDER_STALE';
  constructor() {
    super('Your links changed somewhere else. Reload to see the latest, then try again.');
    this.name = 'LinkOrderStaleError';
  }
}

/** A picture of a Pictures or GIF widget as its owner's editor sees it. `key` is a public-store key; apps/web turns it into a URL. */
export type PictureRow = { id: string; key: string; contentType: string; width: number; height: number; bytes: number; position: number };
const PICTURE_SELECT = { id: true, key: true, contentType: true, width: true, height: true, bytes: true, position: true } as const;
const SELECT = {
  id: true,
  label: true,
  url: true,
  size: true,
  kind: true,
  provider: true,
  embedRef: true,
  embedTitle: true,
  embedImage: true,
  pictureMode: true,
  altText: true,
  pictures: { orderBy: { position: 'asc' }, select: PICTURE_SELECT },
} as const;
export const LINK_SELECT = SELECT;
export type LinkRow = {
  id: string;
  label: string;
  url: string;
  size: TileSize | null;
  kind: 'LINK' | 'WIDGET';
  provider: DbWidgetProvider | null;
  embedRef: string | null;
  embedTitle: string | null;
  embedImage: string | null;
  /** CAROUSEL, GRID, FULL or SQUARE on a Pictures or GIF widget; null on every other row. */
  pictureMode: DbPictureMode | null;
  /** The description for screen readers of a Pictures or GIF widget. */
  altText: string | null;
  /** A Pictures or GIF widget's pictures in order; empty on every other row. */
  pictures: PictureRow[];
};
export type ResolveShort = (url: string) => Promise<string | null>;

/** The card a widget row draws: only Spotify and Apple Music have one, every other row (and a failed fetch) keeps both null. */
async function cardFor(provider: DbWidgetProvider, embedRef: string, card: FetchWidgetCard): Promise<{ embedTitle: string | null; embedImage: string | null }> {
  if (!hasCard(provider)) return { embedTitle: null, embedImage: null };
  const { title, image } = await card(provider, embedRef);
  return { embedTitle: title, embedImage: image };
}

export function checkAltText(raw: string | null | undefined): string | null {
  const alt = (raw ?? '').trim();
  if (alt === '') return null;
  if (charCount(alt) > ALT_TEXT_MAX) throw new InvalidWidgetError(`Describe the pictures in up to ${ALT_TEXT_MAX} characters.`);
  return alt;
}

function checkMode(provider: PictureProvider, mode: PictureMode): void {
  if (!MODES_FOR[provider].includes(mode)) {
    throw new InvalidWidgetError(provider === 'GIF' ? 'A GIF shows full width or square.' : 'Pick how the pictures show.');
  }
}

async function pageIdFor(prisma: PrismaClient, accountId: string): Promise<string> {
  const page = await prisma.page.findUnique({ where: { accountId }, select: { id: true } });
  if (!page) throw new NoPageError();
  return page.id;
}

function checkLabel(raw: string): string {
  const label = raw.trim();
  if (label === '' || charCount(label) > LABEL_MAX) {
    throw new InvalidLinkError(`Give the link a name, up to ${LABEL_MAX} characters.`);
  }
  return label;
}

function checkUrl(raw: string): string {
  const url = normalizeLinkUrl(raw);
  if (!url) {
    throw new InvalidLinkError('That link does not look right. Use a web address, an email (mailto:) or a phone number (tel:).');
  }
  return url;
}

/**
 * A pasted widget link as the pair to store. A short link takes one hop through `resolve`, and the
 * answer must itself parse and name the same provider the short host did, or it is refused.
 */
async function parseWidget(raw: string, resolve: ResolveShort): Promise<{ provider: DbWidgetProvider; embedRef: string }> {
  const first = parseWidgetLink(raw);
  if (first.ok) return { provider: first.provider, embedRef: first.embedRef };
  if (!first.short) throw new InvalidWidgetError(first.message);

  const target = await resolve(raw.trim());
  const second = target === null ? null : parseWidgetLink(target);
  if (second === null || !second.ok || second.provider !== first.provider) {
    throw new InvalidWidgetError(`We could not open that short link. Paste the full ${WIDGET_NAMES[first.provider]} link instead.`);
  }
  return { provider: second.provider, embedRef: second.embedRef };
}

export async function listLinks(prisma: PrismaClient, accountId: string): Promise<LinkRow[]> {
  const pageId = await pageIdFor(prisma, accountId);
  return prisma.link.findMany({ where: { pageId }, orderBy: { position: 'asc' }, select: SELECT });
}

/**
 * A new link joins the end of the links: its full-list index is just after the last existing link
 * (0 when there are none). The shop and FAQ index the full list, so any that sit at or after that
 * index move up one; a tile placed before the last link keeps its place among the links.
 * While the shop is closed its stored position is not in play.
 */
async function makeRoomAtEndOfLinks(tx: Prisma.TransactionClient, pageId: string, linkCount: number): Promise<void> {
  const page = await tx.page.findUnique({ where: { id: pageId }, select: { storeEnabled: true, shopTilePosition: true, faqPosition: true } });
  if (!page) return;
  const moved = positionsAfterAdd(linkCount, page.storeEnabled ? page.shopTilePosition : null, page.faqPosition);
  const data: { shopTilePosition?: number; faqPosition?: number } = {};
  if (page.storeEnabled && moved.shop !== null && moved.shop !== page.shopTilePosition) data.shopTilePosition = moved.shop;
  if (moved.faq !== null && moved.faq !== page.faqPosition) data.faqPosition = moved.faq;
  if (Object.keys(data).length > 0) await tx.page.update({ where: { id: pageId }, data });
}

/**
 * Joins the end of the links. The count-then-create can let two simultaneous adds reach
 * MAX_LINKS + 1; the limit is a product rule, not a safety one, and one extra
 * link is not worth a lock.
 */
export async function addLink(
  prisma: PrismaClient,
  accountId: string,
  input: { label: string; url: string },
): Promise<LinkRow> {
  const label = checkLabel(input.label);
  const url = checkUrl(input.url);
  const pageId = await pageIdFor(prisma, accountId);

  const count = await prisma.link.count({ where: { pageId } });
  if (count >= MAX_LINKS) throw new LinkLimitError();

  return prisma.$transaction(async (tx) => {
    await makeRoomAtEndOfLinks(tx, pageId, count);
    return tx.link.create({ data: { pageId, label, url, position: count }, select: SELECT });
  });
}

/** Joins the end of the links, like a link. Saves kind, provider and embedRef together; the database does not pair them. */
export async function addWidget(
  prisma: PrismaClient,
  accountId: string,
  input: { url: string; label: string | null },
  resolve: ResolveShort,
  card: FetchWidgetCard = async () => ({ title: null, image: null }),
): Promise<LinkRow> {
  const pageId = await pageIdFor(prisma, accountId);
  const url = input.url.trim();
  const { provider, embedRef } = await parseWidget(url, resolve);
  const label = input.label === null || input.label.trim() === '' ? WIDGET_NAMES[provider] : checkLabel(input.label);

  const count = await prisma.link.count({ where: { pageId } });
  if (count >= MAX_LINKS) throw new LinkLimitError();
  // Asked once, outside the transaction; a failure is two nulls and the widget saves anyway.
  const embedCard = await cardFor(provider, embedRef, card);

  return prisma.$transaction(async (tx) => {
    await makeRoomAtEndOfLinks(tx, pageId, count);
    return tx.link.create({
      data: { pageId, label, url, position: count, kind: 'WIDGET', provider, embedRef, ...embedCard },
      select: SELECT,
    });
  });
}

/** A Pictures or GIF widget with no pictures yet, joining the end of the links. Its url is empty: it has nothing to open. */
export async function addPictureWidget(
  prisma: PrismaClient,
  accountId: string,
  input: { provider: PictureProvider; mode?: PictureMode | undefined; label?: string | null | undefined; altText?: string | null | undefined },
): Promise<LinkRow> {
  if (!PICTURE_PROVIDERS.includes(input.provider)) throw new InvalidWidgetError('Pick Pictures or GIF.');
  const pageId = await pageIdFor(prisma, accountId);
  const mode = input.mode ?? (input.provider === 'GIF' ? 'FULL' : 'CAROUSEL');
  checkMode(input.provider, mode);
  const label = input.label == null || input.label.trim() === '' ? WIDGET_NAMES[input.provider] : checkLabel(input.label);
  const altText = checkAltText(input.altText);

  const count = await prisma.link.count({ where: { pageId } });
  if (count >= MAX_LINKS) throw new LinkLimitError();
  return prisma.$transaction(async (tx) => {
    await makeRoomAtEndOfLinks(tx, pageId, count);
    return tx.link.create({
      data: { pageId, label, url: '', position: count, kind: 'WIDGET', provider: input.provider, pictureMode: mode, altText },
      select: SELECT,
    });
  });
}

export async function updateLink(
  prisma: PrismaClient,
  accountId: string,
  id: string,
  input: { label?: string; url?: string; size?: TileSize | null; pictureMode?: PictureMode; altText?: string | null },
  resolve: ResolveShort = async () => null,
  card: FetchWidgetCard = async () => ({ title: null, image: null }),
): Promise<LinkRow> {
  const pageId = await pageIdFor(prisma, accountId);
  const existing = await prisma.link.findFirst({ where: { id, pageId }, select: { kind: true, provider: true } });
  if (!existing) throw new LinkNotFoundError();
  const pictureProvider = existing.kind === 'WIDGET' && isPictureProvider(existing.provider) ? existing.provider : null;
  if (!pictureProvider) {
    if (input.pictureMode !== undefined || input.altText !== undefined) throw new InvalidWidgetError('Only Pictures and GIF widgets have a display mode or a description.');
  } else if (input.url !== undefined) {
    throw new InvalidWidgetError('A Pictures or GIF widget has no address.');
  }

  const data: {
    label?: string;
    url?: string;
    size?: TileSize | null;
    provider?: DbWidgetProvider;
    embedRef?: string;
    embedTitle?: string | null;
    embedImage?: string | null;
    pictureMode?: PictureMode;
    altText?: string | null;
  } = {};
  if (input.url !== undefined) {
    if (existing.kind === 'WIDGET') {
      data.url = input.url.trim();
      const parsed = await parseWidget(data.url, resolve);
      // A new address means a new card; a row that stopped being a card loses the old one.
      Object.assign(data, parsed, await cardFor(parsed.provider, parsed.embedRef, card));
    } else {
      data.url = checkUrl(input.url);
    }
  }
  if (input.label !== undefined) {
    // A widget with its name cleared takes the service's name, as when it was added.
    const named = existing.kind === 'WIDGET' ? (data.provider ?? existing.provider) : null;
    data.label = named && input.label.trim() === '' ? WIDGET_NAMES[named] : checkLabel(input.label);
  }
  if (input.size !== undefined) data.size = input.size;
  if (pictureProvider) {
    if (input.pictureMode !== undefined) {
      checkMode(pictureProvider, input.pictureMode);
      data.pictureMode = input.pictureMode;
    }
    if (input.altText !== undefined) data.altText = checkAltText(input.altText);
  }

  const updated = await prisma.link.updateMany({ where: { id, pageId }, data });
  if (updated.count !== 1) throw new LinkNotFoundError();
  return prisma.link.findUniqueOrThrow({ where: { id }, select: SELECT });
}

/** The row goes, and with it its pictures' rows; the keys come back so the caller can delete their objects. */
export async function removeLink(prisma: PrismaClient, accountId: string, id: string): Promise<{ pictureKeys: string[] }> {
  const pageId = await pageIdFor(prisma, accountId);
  let pictureKeys: string[] = [];
  await prisma.$transaction(async (tx) => {
    const link = await tx.link.findFirst({ where: { id, pageId }, select: { position: true, pictures: { select: { key: true } } } });
    if (!link) throw new LinkNotFoundError();
    pictureKeys = link.pictures.map((p) => p.key);
    await tx.link.delete({ where: { id } });
    // Close the gap, so positions stay 0..n-1 and the next add lands last.
    await tx.link.updateMany({ where: { pageId, position: { gt: link.position } }, data: { position: { decrement: 1 } } });
    // link.position counts links only; the shop and FAQ positions index the full list. Find the
    // removed link's index in the full list (lowest tile first, so the second comparison sees the
    // first's effect), then pull down every tile that sat after it. While the shop is closed its
    // stored position is not in play, and reorderLinks rewrites it when it opens.
    const page = await tx.page.findUnique({
      where: { id: pageId },
      select: { storeEnabled: true, shopTilePosition: true, faqPosition: true },
    });
    if (!page) return;
    const tiles: { key: 'shopTilePosition' | 'faqPosition'; position: number }[] = [];
    if (page.storeEnabled) tiles.push({ key: 'shopTilePosition', position: page.shopTilePosition });
    if (page.faqPosition !== null) tiles.push({ key: 'faqPosition', position: page.faqPosition });
    tiles.sort((x, y) => x.position - y.position);
    let removedAt = link.position;
    for (const tile of tiles) if (tile.position <= removedAt) removedAt += 1;
    const data: { shopTilePosition?: number; faqPosition?: number } = {};
    for (const tile of tiles) if (tile.position > removedAt) data[tile.key] = tile.position - 1;
    if (Object.keys(data).length > 0) await tx.page.update({ where: { id: pageId }, data });
  });
  return { pictureKeys };
}

/**
 * The whole order in one transaction, refused unless `ids` is exactly the
 * page's current set -- no more, no fewer, no repeats. A second tab working
 * from a list that has since changed gets LINK_ORDER_STALE, not a silent
 * half-applied order.
 *
 * The shop tile travels in the same list as SHOP_TILE_ID, exactly once while
 * the shop is open and never while it is closed, so the editor drags it like
 * any link. Its index is the page's shopTilePosition.
 *
 * The FAQ block travels as FAQ_TILE_ID, exactly once on a business page and never on a personal one;
 * its index is faqPosition. A business list without it would store the shop as an index into a list
 * without the FAQ block, shifting the shop, so it is stale like any other wrong set.
 */
export async function reorderLinks(prisma: PrismaClient, accountId: string, ids: string[]): Promise<void> {
  const page = await prisma.page.findUnique({ where: { accountId }, select: { id: true, storeEnabled: true, mode: true } });
  if (!page) throw new NoPageError();
  await prisma.$transaction(async (tx) => {
    const shopAt = ids.indexOf(SHOP_TILE_ID);
    const shopCount = ids.filter((id) => id === SHOP_TILE_ID).length;
    if (shopCount !== (page.storeEnabled ? 1 : 0)) throw new LinkOrderStaleError();
    const faqAt = ids.indexOf(FAQ_TILE_ID);
    const faqCount = ids.filter((id) => id === FAQ_TILE_ID).length;
    if (faqCount !== (page.mode === 'BUSINESS' ? 1 : 0)) throw new LinkOrderStaleError();
    const linkIds = ids.filter((id) => id !== SHOP_TILE_ID && id !== FAQ_TILE_ID);

    const current = await tx.link.findMany({ where: { pageId: page.id }, select: { id: true } });
    const known = new Set(current.map((link) => link.id));
    const sent = new Set(linkIds);
    if (sent.size !== linkIds.length || sent.size !== known.size || linkIds.some((id) => !known.has(id))) {
      throw new LinkOrderStaleError();
    }
    for (const [position, id] of linkIds.entries()) {
      await tx.link.update({ where: { id }, data: { position } });
    }
    await tx.page.update({
      where: { id: page.id },
      data: { ...(page.storeEnabled ? { shopTilePosition: shopAt } : {}), ...(page.mode === 'BUSINESS' ? { faqPosition: faqAt === ids.length - 1 ? null : faqAt } : {}) },
    });
  });
}
