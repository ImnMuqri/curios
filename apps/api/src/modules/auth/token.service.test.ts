import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@curios/db';
import { consumeToken, issueToken } from './token.service.js';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL_TEST } },
});

async function anAccount(): Promise<string> {
  const account = await prisma.account.create({
    data: { email: `tok-${randomUUID()}@example.com` },
    select: { id: true },
  });
  return account.id;
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
});

describe('consumeToken', () => {
  it('accepts a freshly issued token once', async () => {
    const accountId = await anAccount();
    const value = await issueToken(prisma, accountId, 'EMAIL_VERIFICATION');

    expect(await consumeToken(prisma, value, 'EMAIL_VERIFICATION')).toEqual({ accountId });
  });

  it('refuses the same token a second time', async () => {
    const accountId = await anAccount();
    const value = await issueToken(prisma, accountId, 'PASSWORD_RESET');
    await consumeToken(prisma, value, 'PASSWORD_RESET');

    // A reset link in an inbox is reusable forever unless this holds.
    expect(await consumeToken(prisma, value, 'PASSWORD_RESET')).toBeNull();
  });

  it('refuses a token presented for the wrong purpose', async () => {
    const accountId = await anAccount();
    const value = await issueToken(prisma, accountId, 'EMAIL_VERIFICATION');

    // Otherwise a verification link doubles as a password reset.
    expect(await consumeToken(prisma, value, 'PASSWORD_RESET')).toBeNull();
  });

  it('refuses an expired token', async () => {
    const accountId = await anAccount();
    const value = await issueToken(prisma, accountId, 'PASSWORD_RESET');
    await prisma.authToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

    expect(await consumeToken(prisma, value, 'PASSWORD_RESET')).toBeNull();
  });

  it('refuses a value that was never issued', async () => {
    expect(await consumeToken(prisma, 'invented', 'EMAIL_VERIFICATION')).toBeNull();
  });

  it('lets only one of two simultaneous uses win', async () => {
    const accountId = await anAccount();
    const value = await issueToken(prisma, accountId, 'PASSWORD_RESET');

    const results = await Promise.all([
      consumeToken(prisma, value, 'PASSWORD_RESET'),
      consumeToken(prisma, value, 'PASSWORD_RESET'),
    ]);

    // Single-use has to mean single-use under concurrency, or a double-clicked
    // link consumes it twice and the second caller resets a password on a
    // token that was already spent.
    expect(results.filter((r) => r !== null)).toHaveLength(1);
  });
});

describe('issueToken', () => {
  it('stores a hash, never the value that goes in the email', async () => {
    const accountId = await anAccount();
    const value = await issueToken(prisma, accountId, 'EMAIL_VERIFICATION');

    const rows = await prisma.authToken.findMany({ select: { id: true } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).not.toBe(value);
  });
});
