import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { defaultSettings } from '@curios/core/settings';
import { clearSettingsCache, getSettings } from './settings.query.js';

const write = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  clearSettingsCache();
  await write.systemSetting.deleteMany();
});
afterEach(() => vi.useRealTimers());
afterAll(async () => {
  await write.systemSetting.deleteMany();
  await write.$disconnect();
});

describe('getSettings', () => {
  it('is the defaults with no rows', async () => {
    expect(await getSettings()).toEqual(defaultSettings());
  });

  it('reads stored rows through the readonly role', async () => {
    await write.systemSetting.create({ data: { key: 'cap', value: 25 } });
    expect((await getSettings()).cap).toBe(25);
  });

  it('serves the cache inside 30 seconds and reads again after', async () => {
    await write.systemSetting.create({ data: { key: 'cap', value: 25 } });
    expect((await getSettings()).cap).toBe(25);
    await write.systemSetting.update({ where: { key: 'cap' }, data: { value: 30 } });
    vi.setSystemTime(Date.now() + 29_000);
    expect((await getSettings()).cap).toBe(25);
    vi.setSystemTime(Date.now() + 2_000);
    expect((await getSettings()).cap).toBe(30);
  });

  it('re-reads after clearSettingsCache()', async () => {
    await getSettings();
    await write.systemSetting.create({ data: { key: 'cap', value: 7 } });
    clearSettingsCache();
    expect((await getSettings()).cap).toBe(7);
  });
});
