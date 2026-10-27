import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { defaultSettings } from '@curios/core/settings';
import { prismaRead } from '../client.js';
import { getStoredSettings } from './settings.query.js';

const write = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

beforeEach(async () => {
  await write.systemSetting.deleteMany();
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await write.systemSetting.deleteMany();
  await write.$disconnect();
});

describe('getStoredSettings', () => {
  it('is the defaults with no rows, and reads stored rows over them', async () => {
    expect(await getStoredSettings()).toEqual(defaultSettings());
    await write.systemSetting.create({ data: { key: 'cap', value: 25 } });
    expect((await getStoredSettings()).cap).toBe(25);
  });

  it('is not cached: a row written a moment ago shows at once', async () => {
    await getStoredSettings();
    await write.systemSetting.create({ data: { key: 'switch.chat', value: false } });
    expect((await getStoredSettings()).switches.chat).toBe(false);
  });

  it('throws when the read fails, rather than answering with the defaults', async () => {
    vi.spyOn(prismaRead.systemSetting, 'findMany').mockRejectedValueOnce(new Error('connection refused'));
    await expect(getStoredSettings()).rejects.toThrow('connection refused');
  });
});
