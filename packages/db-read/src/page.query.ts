import type { FactCategory } from '@curios/core';
import { prismaRead } from './client.js';

export interface PublicLink {
  id: string;
  label: string;
  url: string;
  icon: string | null;
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
      mode: true,
      paidUntil: true,
      leadsCaptured: true,
      allowSearchIndexing: true,
      links: {
        orderBy: { position: 'asc' },
        select: { id: true, label: true, url: true, icon: true, position: true },
      },
      facts: {
        where: { verified: true },
        orderBy: { createdAt: 'asc' },
        select: { id: true, category: true, claim: true, question: true },
      },
    },
  });

  return page;
}
