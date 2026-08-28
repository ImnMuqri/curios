import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@curios/db';
import { hashToken } from '../../lib/tokens.js';
import {
  createSession,
  revokeAllSessions,
  revokeSession,
  validateSession,
} from './session.service.js';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL_TEST } },
});

async function anAccount(): Promise<string> {
  const account = await prisma.account.create({
    data: { email: `sess-${randomUUID()}@example.com` },
    select: { id: true },
  });
  return account.id;
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
});

describe('createSession', () => {
  it('returns a value that is not what gets stored', async () => {
    const accountId = await anAccount();
    const { value } = await createSession(prisma, accountId);

    const stored = await prisma.session.findMany({ select: { id: true } });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.id).toBe(hashToken(value));
    expect(stored[0]?.id).not.toBe(value);
  });
});

describe('validateSession', () => {
  it('accepts a live session', async () => {
    const accountId = await anAccount();
    const { value } = await createSession(prisma, accountId);

    expect(await validateSession(prisma, value)).toEqual({ accountId });
  });

  it('rejects a value that was never issued', async () => {
    expect(await validateSession(prisma, 'not-a-real-token')).toBeNull();
  });

  it('rejects an expired session and does not resurrect it', async () => {
    const accountId = await anAccount();
    const { value } = await createSession(prisma, accountId);
    await prisma.session.update({
      where: { id: hashToken(value) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect(await validateSession(prisma, value)).toBeNull();
  });

  it('extends a session that is past half its life, so an active owner never expires', async () => {
    const accountId = await anAccount();
    const { value } = await createSession(prisma, accountId);
    const id = hashToken(value);

    // Ten days: past the seven-day refresh threshold, comfortably short of the
    // fourteen-day idle limit. Not fourteen -- that sits exactly on the idle
    // boundary, so the few milliseconds between this update and the call below
    // tip the session into idle-expiry and `validateSession` returns null
    // before the refresh branch can run.
    const stale = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await prisma.session.update({ where: { id }, data: { lastSeenAt: stale } });

    await validateSession(prisma, value);

    const after = await prisma.session.findUniqueOrThrow({ where: { id } });
    expect(after.lastSeenAt.getTime()).toBeGreaterThan(stale.getTime());
  });

  it('does not write on every request', async () => {
    const accountId = await anAccount();
    const { value } = await createSession(prisma, accountId);
    const id = hashToken(value);

    await validateSession(prisma, value);
    const first = await prisma.session.findUniqueOrThrow({ where: { id } });
    await validateSession(prisma, value);
    const second = await prisma.session.findUniqueOrThrow({ where: { id } });

    // A write per request would make this the busiest table in the database.
    expect(second.lastSeenAt.getTime()).toBe(first.lastSeenAt.getTime());
  });
});

describe('revoking', () => {
  it('makes a session immediately unusable', async () => {
    const accountId = await anAccount();
    const { value } = await createSession(prisma, accountId);

    await revokeSession(prisma, value);

    expect(await validateSession(prisma, value)).toBeNull();
  });

  it('signs out every device at once', async () => {
    const accountId = await anAccount();
    const one = await createSession(prisma, accountId);
    const two = await createSession(prisma, accountId);

    await revokeAllSessions(prisma, accountId);

    expect(await validateSession(prisma, one.value)).toBeNull();
    expect(await validateSession(prisma, two.value)).toBeNull();
  });
});
