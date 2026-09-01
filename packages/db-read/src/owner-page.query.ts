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
 * `findUnique`, not `findFirst`. `Page.accountId` carries a unique index, so
 * at most one row can ever match, and saying so in the call is the difference
 * between a query that happens to return one row and one that cannot return
 * two. Prisma exposes `accountId` directly on the unique-where input for a
 * single-field `@@unique`, so there is no composite key name to work around.
 */
export async function getOwnerPage(accountId: string): Promise<OwnerPage | null> {
  return prismaRead.page.findUnique({
    where: { accountId },
    select: { id: true, handle: true, displayName: true, published: true },
  });
}
