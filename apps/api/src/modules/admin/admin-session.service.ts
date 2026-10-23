import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@curios/db';
import { ADMIN_SESSION_TTL_MS, hashSessionValue } from '@curios/core';

/**
 * Like the owner's session, the cookie holds a random value and the table holds
 * only its hash. Unlike it, the clock is absolute: eight hours from sign-in,
 * with no refresh, so a session cannot be kept alive by use.
 */
export async function createAdminSession(
  prisma: PrismaClient,
  adminUserId: string,
  ip: string,
): Promise<string> {
  const value = randomBytes(32).toString('base64url');

  await prisma.adminSession.create({
    data: {
      id: hashSessionValue(value),
      adminUserId,
      ip,
      expiresAt: new Date(Date.now() + ADMIN_SESSION_TTL_MS),
    },
  });

  return value;
}

export async function validateAdminSession(
  prisma: PrismaClient,
  value: string,
): Promise<{ adminUserId: string; name: string } | null> {
  const session = await prisma.adminSession.findUnique({
    where: { id: hashSessionValue(value) },
    select: {
      expiresAt: true,
      adminUser: { select: { id: true, name: true, disabledAt: true } },
    },
  });

  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;
  if (session.adminUser.disabledAt) return null;

  return { adminUserId: session.adminUser.id, name: session.adminUser.name };
}

export async function revokeAdminSession(prisma: PrismaClient, value: string): Promise<void> {
  // deleteMany rather than delete: signing out twice is not an error.
  await prisma.adminSession.deleteMany({ where: { id: hashSessionValue(value) } });
}
