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
}

/**
 * Everything the public page renders, in one query.
 *
 * Only verified facts are ever exposed. An unreviewed price reaching a customer
 * is the single failure this product cannot recover from.
 */
export async function getPublicPage(handle: string): Promise<PublicPage | null> {
  const page = await prismaRead.page.findUnique({
    where: { handle: handle.toLowerCase() },
    select: {
      id: true,
      handle: true,
      displayName: true,
      bio: true,
      language: true,
      mode: true,
      links: {
        orderBy: { position: 'asc' },
        select: { id: true, label: true, url: true, icon: true, position: true },
      },
      facts: {
        where: { verified: true },
        orderBy: { createdAt: 'asc' },
        select: { id: true, category: true, claim: true },
      },
    },
  });

  return page;
}
