import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getSignInMethods } from './sign-in-methods.query.js';

const write = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

async function anAccount(options: { password?: boolean; google?: boolean }): Promise<{
  id: string;
  email: string;
}> {
  const email = `signin-methods-${randomUUID()}@example.com`;
  const account = await write.account.create({
    data: {
      email,
      ...(options.password ? { password: { create: { hash: 'not-a-real-hash' } } } : {}),
      ...(options.google
        ? {
            identities: {
              create: { provider: 'GOOGLE', providerUserId: randomUUID(), email },
            },
          }
        : {}),
    },
    select: { id: true },
  });
  return { id: account.id, email };
}

describe('getSignInMethods', () => {
  it('returns null for an account that does not exist', async () => {
    // Settings is reached only through a validated session, so this should
    // never happen in practice -- but the type says it can, and a caller that
    // forgets to check gets a thrown Prisma error on a null field instead of
    // a controlled redirect.
    expect(await getSignInMethods('not-a-real-account-id')).toBeNull();
  });

  it('reports a password-only account', async () => {
    const account = await anAccount({ password: true });

    expect(await getSignInMethods(account.id)).toEqual({
      email: account.email,
      hasPassword: true,
      providers: [],
    });
  });

  it('reports a Google-only account', async () => {
    const account = await anAccount({ google: true });

    expect(await getSignInMethods(account.id)).toEqual({
      email: account.email,
      hasPassword: false,
      providers: ['GOOGLE'],
    });
  });

  it('reports an account with both', async () => {
    const account = await anAccount({ password: true, google: true });

    expect(await getSignInMethods(account.id)).toEqual({
      email: account.email,
      hasPassword: true,
      providers: ['GOOGLE'],
    });
  });

  it('does not write, so the read-only role can run it', async () => {
    const account = await anAccount({ password: true });
    const before = await write.account.findUnique({ where: { id: account.id }, select: { email: true } });

    await getSignInMethods(account.id);

    const after = await write.account.findUnique({ where: { id: account.id }, select: { email: true } });
    expect(after?.email).toBe(before?.email);
  });
});
