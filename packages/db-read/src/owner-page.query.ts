import { prismaRead } from './client.js';

export interface OwnerPage {
  id: string;
  handle: string;
  displayName: string;
  published: boolean;
}

/**
 * The signed-in owner's own page, published or not.
 *
 * Deliberately not a reuse of `getPublicPage`. That one takes a handle and
 * filters `published: true`, which is right for a visitor and useless here: an
 * owner who has not published yet would look to the dashboard exactly like an
 * owner who has no page, which is the one distinction onboarding turns on.
 *
 * `findFirst` rather than `findUnique`: `Page.accountId` carries a unique
 * index, so this can only ever match 0 or 1 rows, and `findFirst` states that
 * without depending on the generated name of the composite where-input.
 */
export async function getOwnerPage(accountId: string): Promise<OwnerPage | null> {
  return prismaRead.page.findFirst({
    where: { accountId },
    select: { id: true, handle: true, displayName: true, published: true },
  });
}
