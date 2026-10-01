import type { HeadingFont, PageStyle, TileSize } from '@curios/core/bento';
import { prismaRead } from './client.js';

export interface MyCurios {
  id: string;
  handle: string;
  displayName: string;
  bio: string | null;
  style: PageStyle;
  accentColor: string;
  headingFont: HeadingFont;
  avatarKey: string | null;
  links: { id: string; label: string; url: string; size: TileSize | null }[];
}

/** Everything the My Curios editor starts from, in one query. */
export async function getMyCurios(accountId: string): Promise<MyCurios | null> {
  return prismaRead.page.findUnique({
    where: { accountId },
    select: {
      id: true,
      handle: true,
      displayName: true,
      bio: true,
      style: true,
      accentColor: true,
      headingFont: true,
      avatarKey: true,
      links: { orderBy: { position: 'asc' }, select: { id: true, label: true, url: true, size: true } },
    },
  });
}

/**
 * Facts still waiting for review, for the sidebar's count. The review queue's
 * own filter (review.query.ts), so the number matches the screen it links to.
 */
export async function countPendingFacts(accountId: string): Promise<number> {
  return prismaRead.fact.count({ where: { page: { accountId }, verified: false, rejectedAt: null } });
}
