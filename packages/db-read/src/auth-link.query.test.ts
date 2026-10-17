import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { hashSessionValue } from '@curios/core';
import { getAuthLink } from './auth-link.query.js';

const write = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

let accountId = '';
const email = `link-${randomUUID()}@example.com`;

beforeAll(async () => {
  accountId = (await write.account.create({ data: { email, name: 'Lina' }, select: { id: true } })).id;
});

afterAll(async () => {
  await write.account.delete({ where: { id: accountId } });
  await write.$disconnect();
});

async function aLink(kind: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET', fields: { expiresAt?: Date; usedAt?: Date } = {}) {
  const value = randomUUID();
  await write.authToken.create({
    data: { id: hashSessionValue(value), accountId, kind, expiresAt: fields.expiresAt ?? new Date(Date.now() + 60_000), usedAt: fields.usedAt },
  });
  return value;
}

describe('getAuthLink', () => {
  it('names the address of a usable link, without spending it', async () => {
    const value = await aLink('PASSWORD_RESET');

    expect(await getAuthLink(value, 'PASSWORD_RESET')).toEqual({ state: 'usable', email, name: 'Lina', verified: false });
    expect((await write.authToken.findUnique({ where: { id: hashSessionValue(value) } }))?.usedAt).toBeNull();
  });

  it('tells an expired link from a followed one', async () => {
    const old = await aLink('EMAIL_VERIFICATION', { expiresAt: new Date(Date.now() - 1000) });
    const used = await aLink('EMAIL_VERIFICATION', { usedAt: new Date() });

    expect(await getAuthLink(old, 'EMAIL_VERIFICATION')).toMatchObject({ state: 'expired', email });
    expect(await getAuthLink(used, 'EMAIL_VERIFICATION')).toMatchObject({ state: 'used', email });
  });

  it('knows nothing of a link of the other kind, or one never issued', async () => {
    const reset = await aLink('PASSWORD_RESET');

    expect(await getAuthLink(reset, 'EMAIL_VERIFICATION')).toEqual({ state: 'unknown' });
    expect(await getAuthLink('invented', 'PASSWORD_RESET')).toEqual({ state: 'unknown' });
  });
});
