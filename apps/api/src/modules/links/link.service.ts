import type { PrismaClient } from '@curios/db';
import { charCount, LABEL_MAX, MAX_LINKS, normalizeLinkUrl, SHOP_TILE_ID, type TileSize } from '@curios/core/bento';
import { NoPageError } from '../pages/page.service.js';

export class InvalidLinkError extends Error {
  readonly statusCode = 400;
  readonly code = 'INVALID_LINK';
  constructor(message: string) {
    super(message);
    this.name = 'InvalidLinkError';
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

const SELECT = { id: true, label: true, url: true, size: true } as const;
export type LinkRow = { id: string; label: string; url: string; size: TileSize | null };

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

export async function listLinks(prisma: PrismaClient, accountId: string): Promise<LinkRow[]> {
  const pageId = await pageIdFor(prisma, accountId);
  return prisma.link.findMany({ where: { pageId }, orderBy: { position: 'asc' }, select: SELECT });
}

/**
 * Appended last. The count-then-create can let two simultaneous adds reach
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

  return prisma.link.create({ data: { pageId, label, url, position: count }, select: SELECT });
}

export async function updateLink(
  prisma: PrismaClient,
  accountId: string,
  id: string,
  input: { label?: string; url?: string; size?: TileSize | null },
): Promise<LinkRow> {
  const data: { label?: string; url?: string; size?: TileSize | null } = {};
  if (input.label !== undefined) data.label = checkLabel(input.label);
  if (input.url !== undefined) data.url = checkUrl(input.url);
  if (input.size !== undefined) data.size = input.size;

  const pageId = await pageIdFor(prisma, accountId);
  const updated = await prisma.link.updateMany({ where: { id, pageId }, data });
  if (updated.count !== 1) throw new LinkNotFoundError();
  return prisma.link.findUniqueOrThrow({ where: { id }, select: SELECT });
}

export async function removeLink(prisma: PrismaClient, accountId: string, id: string): Promise<void> {
  const pageId = await pageIdFor(prisma, accountId);
  await prisma.$transaction(async (tx) => {
    const link = await tx.link.findFirst({ where: { id, pageId }, select: { position: true } });
    if (!link) throw new LinkNotFoundError();
    await tx.link.delete({ where: { id } });
    // Close the gap, so positions stay 0..n-1 and the next add lands last.
    await tx.link.updateMany({ where: { pageId, position: { gt: link.position } }, data: { position: { decrement: 1 } } });
  });
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
 */
export async function reorderLinks(prisma: PrismaClient, accountId: string, ids: string[]): Promise<void> {
  const page = await prisma.page.findUnique({ where: { accountId }, select: { id: true, storeEnabled: true } });
  if (!page) throw new NoPageError();
  await prisma.$transaction(async (tx) => {
    const shopAt = ids.indexOf(SHOP_TILE_ID);
    const shopCount = ids.filter((id) => id === SHOP_TILE_ID).length;
    if (shopCount !== (page.storeEnabled ? 1 : 0)) throw new LinkOrderStaleError();
    const linkIds = ids.filter((id) => id !== SHOP_TILE_ID);

    const current = await tx.link.findMany({ where: { pageId: page.id }, select: { id: true } });
    const known = new Set(current.map((link) => link.id));
    const sent = new Set(linkIds);
    if (sent.size !== linkIds.length || sent.size !== known.size || linkIds.some((id) => !known.has(id))) {
      throw new LinkOrderStaleError();
    }
    for (const [position, id] of linkIds.entries()) {
      await tx.link.update({ where: { id }, data: { position } });
    }
    if (page.storeEnabled) await tx.page.update({ where: { id: page.id }, data: { shopTilePosition: shopAt } });
  });
}
