import type { PrismaClient } from '@curios/db';

/**
 * Creates an admin, or resets an existing one: new password and name, account
 * enabled again, and every session of theirs ended in the same transaction, so
 * a cookie taken before the reset stops working with the old password.
 */
export async function createOrResetAdmin(
  prisma: PrismaClient,
  input: { email: string; name: string; passwordHash: string },
): Promise<'created' | 'reset'> {
  const { email, name, passwordHash } = input;
  const existing = await prisma.adminUser.findUnique({ where: { email }, select: { id: true } });

  if (!existing) {
    await prisma.adminUser.create({ data: { email, name, passwordHash } });
    return 'created';
  }

  await prisma.$transaction([
    prisma.adminUser.update({
      where: { id: existing.id },
      data: { passwordHash, name, disabledAt: null },
    }),
    prisma.adminSession.deleteMany({ where: { adminUserId: existing.id } }),
  ]);
  return 'reset';
}
