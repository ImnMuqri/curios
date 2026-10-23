import { prismaRead } from '../client.js';

/**
 * Whether this admin has a VIEWED_AS_OWNER row for this page at or after `since`.
 * The owner view only renders behind such a row, so a direct visit leaves no way around the log.
 */
export async function hasRecentOwnerView(input: { adminUserId: string; pageId: string; since: Date }): Promise<boolean> {
  const row = await prismaRead.adminAction.findFirst({
    where: {
      adminUserId: input.adminUserId,
      action: 'VIEWED_AS_OWNER',
      targetType: 'Page',
      targetId: input.pageId,
      createdAt: { gte: input.since },
    },
    select: { id: true },
  });
  return row !== null;
}
