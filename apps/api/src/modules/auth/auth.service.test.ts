import { beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { findOrCreateAccountForGoogle } from './auth.service.js';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
});

const profile = {
  sub: 'google-sub-1',
  email: 'nadia@example.com',
  emailVerified: true,
  name: 'Nadia',
};

describe('findOrCreateAccountForGoogle', () => {
  it('creates an account and identity on first sign in', async () => {
    const { accountId } = await findOrCreateAccountForGoogle(prisma, profile);
    const account = await prisma.account.findUniqueOrThrow({
      where: { id: accountId },
      include: { identities: true },
    });
    expect(account.email).toBe('nadia@example.com');
    expect(account.identities[0]?.providerUserId).toBe('google-sub-1');
  });

  it('returns the same account on second sign in', async () => {
    const first = await findOrCreateAccountForGoogle(prisma, profile);
    const second = await findOrCreateAccountForGoogle(prisma, profile);
    expect(second.accountId).toBe(first.accountId);
    expect(await prisma.account.count()).toBe(1);
  });

  it('follows the sub, not the email, when the email changes', async () => {
    const first = await findOrCreateAccountForGoogle(prisma, profile);
    const renamed = { ...profile, email: 'nadia@newdomain.com' };
    const second = await findOrCreateAccountForGoogle(prisma, renamed);

    expect(second.accountId).toBe(first.accountId);
    expect(await prisma.account.count()).toBe(1);
  });

  it('never links a new sub to an existing account by matching email', async () => {
    await findOrCreateAccountForGoogle(prisma, profile);
    const attacker = { ...profile, sub: 'google-sub-2' };
    const second = await findOrCreateAccountForGoogle(prisma, attacker);

    // A different subject is a different person, even with the same address.
    expect(await prisma.account.count()).toBe(2);
    expect(second.accountId).not.toBe('');
  });

  it('rejects an unverified email', async () => {
    await expect(
      findOrCreateAccountForGoogle(prisma, { ...profile, emailVerified: false }),
    ).rejects.toThrow(/verified/i);
  });
});
