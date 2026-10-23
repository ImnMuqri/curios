import { hashSessionValue } from '@curios/core';
import { prismaRead } from '../client.js';

/**
 * Who this admin session belongs to, or null. Read-only mirror of the API's
 * validateAdminSession: the same three checks (the row exists, it has not
 * passed its absolute `expiresAt`, the admin is not disabled), with the last
 * two in the WHERE clause so an invalid row is never returned.
 *
 * Selects columns explicitly: the readonly role cannot read
 * AdminUser.passwordHash, and selecting the whole row would fail.
 */
export async function getAdminSession(value: string): Promise<{ adminUserId: string; name: string; email: string } | null> {
  const session = await prismaRead.adminSession.findFirst({
    where: { id: hashSessionValue(value), expiresAt: { gt: new Date() }, adminUser: { disabledAt: null } },
    select: { adminUser: { select: { id: true, name: true, email: true } } },
  });

  return session ? { adminUserId: session.adminUser.id, name: session.adminUser.name, email: session.adminUser.email } : null;
}
