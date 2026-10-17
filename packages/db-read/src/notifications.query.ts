import { prismaRead } from './client.js';

/** Which owner emails are on (Settings, "Email me when"). */
export interface OwnerNotifications {
  /** An email for each lead. */
  leads: boolean;
}

/** The signed-in owner's email switches, scoped to their own page; null with no page yet. */
export async function getNotifications(accountId: string): Promise<OwnerNotifications | null> {
  const page = await prismaRead.page.findUnique({ where: { accountId }, select: { notifyLeads: true } });
  return page ? { leads: page.notifyLeads } : null;
}
