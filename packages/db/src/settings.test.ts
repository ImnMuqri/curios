import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '@curios/core/settings';
import { createSettingsReader } from './settings.js';

type Rows = { key: string; value: unknown }[];

function fakePrisma(findMany: () => Promise<Rows>) {
  const spy = vi.fn(findMany);
  return { prisma: { systemSetting: { findMany: spy } } as never, spy };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createSettingsReader', () => {
  it('serves the cache inside the TTL and reads again after it', async () => {
    const { prisma, spy } = fakePrisma(async () => [{ key: 'cap', value: 10 }]);
    const reader = createSettingsReader(prisma, { ttlMs: 30_000 });
    expect((await reader.get()).cap).toBe(10);
    await vi.advanceTimersByTimeAsync(29_000);
    await reader.get();
    expect(spy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    await reader.get();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('re-reads after clear()', async () => {
    const { prisma, spy } = fakePrisma(async () => []);
    const reader = createSettingsReader(prisma);
    await reader.get();
    reader.clear();
    await reader.get();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('shares one query between concurrent gets', async () => {
    const { prisma, spy } = fakePrisma(async () => []);
    const reader = createSettingsReader(prisma);
    await Promise.all([reader.get(), reader.get(), reader.get()]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('returns the defaults, and logs, when the query throws with nothing cached', async () => {
    const warn = vi.fn();
    const reader = createSettingsReader(fakePrisma(async () => { throw new Error('down'); }).prisma, { log: { warn } });
    expect(await reader.get()).toEqual(defaultSettings());
    expect(warn).toHaveBeenCalled();
  });

  it('keeps serving the last good value when a later query throws', async () => {
    let fail = false;
    const warn = vi.fn();
    const reader = createSettingsReader(
      fakePrisma(async () => {
        if (fail) throw new Error('down');
        return [{ key: 'cap', value: 10 }];
      }).prisma,
      { ttlMs: 1_000, log: { warn } },
    );
    expect((await reader.get()).cap).toBe(10);
    fail = true;
    await vi.advanceTimersByTimeAsync(2_000);
    expect((await reader.get()).cap).toBe(10);
    expect(warn).toHaveBeenCalled();
  });

  it('logs a stored value of the wrong shape and keeps the default', async () => {
    const warn = vi.fn();
    const reader = createSettingsReader(fakePrisma(async () => [{ key: 'cap', value: 'lots' }]).prisma, { log: { warn } });
    expect((await reader.get()).cap).toBe(defaultSettings().cap);
    expect(warn).toHaveBeenCalled();
  });
});
