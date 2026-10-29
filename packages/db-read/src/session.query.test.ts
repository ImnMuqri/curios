import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { hashSessionValue } from '@curios/core';
import { getOwnerSession } from './session.query.js';

const write = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

let accountId = '';
const email = `sess-${randomUUID()}@example.com`;

beforeAll(async () => {
  const account = await write.account.create({
    data: { email, name: 'Lina binti Kamal' },
    select: { id: true },
  });
  accountId = account.id;
});

async function aSession(expiresAt: Date): Promise<string> {
  const value = randomUUID();
  await write.session.create({
    data: { id: hashSessionValue(value), accountId, expiresAt },
  });
  return value;
}

describe('getOwnerSession', () => {
  it("resolves a live session to its account, with the account's own name and email", async () => {
    const value = await aSession(new Date(Date.now() + 60_000));

    expect(await getOwnerSession(value)).toEqual({ accountId, name: 'Lina binti Kamal', email });
  });

  it('refuses a session past its absolute expiry', async () => {
    const value = await aSession(new Date(Date.now() - 1000));

    expect(await getOwnerSession(value)).toBeNull();
  });

  it('refuses a session that has gone idle, exactly as the API does', async () => {
    const value = randomUUID();
    await write.session.create({
      data: {
        id: hashSessionValue(value),
        accountId,
        // Well inside the 30-day absolute window, well outside the 14-day idle
        // one. This is the gap where the API and this function would disagree
        // if only expiresAt were checked.
        expiresAt: new Date(Date.now() + 16 * 24 * 60 * 60 * 1000),
        lastSeenAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
      },
    });

    expect(await getOwnerSession(value)).toBeNull();
  });

  it('refuses a value that was never issued', async () => {
    expect(await getOwnerSession('invented')).toBeNull();
  });

  it('does not write, so the read-only role can run it', async () => {
    const value = await aSession(new Date(Date.now() + 60_000));
    const before = await write.session.findUnique({
      where: { id: hashSessionValue(value) },
      select: { lastSeenAt: true },
    });

    await getOwnerSession(value);

    // The API refreshes sessions. This must not, because apps/web holds a
    // SELECT-only connection -- the trap FRONTEND.md fell into with
    // "refreshed by middleware".
    const after = await write.session.findUnique({
      where: { id: hashSessionValue(value) },
      select: { lastSeenAt: true },
    });
    expect(after?.lastSeenAt.getTime()).toBe(before?.lastSeenAt.getTime());
  });
});
