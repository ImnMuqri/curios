import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BANNER_MAX, createSettingsCache, defaultSettings, fallbackSettings, isBigPriceChange, isFallbackSettings, resolveSettings } from './settings.js';

describe('resolveSettings', () => {
  it('is the defaults when nothing is stored', () => {
    expect(resolveSettings([])).toEqual(defaultSettings());
  });

  it('defaults to every switch on, no banner, and the existing constants', () => {
    const d = defaultSettings();
    expect(Object.values(d.switches).every((on) => on)).toBe(true);
    expect(d.banner).toBeNull();
    expect(d.prices).toEqual({ MONTHLY: 4900, ANNUAL: 49000 });
    expect(d.freeLeads).toBe(3);
    expect(d.freeOrders).toBe(3);
  });

  it('applies good values', () => {
    const s = resolveSettings([
      { key: 'switch.chat', value: false },
      { key: 'cap', value: 50 },
      { key: 'freeLeads', value: 1 },
      { key: 'freeOrders', value: 10 },
      { key: 'price.MONTHLY', value: 5900 },
      { key: 'price.ANNUAL', value: 59000 },
      { key: 'banner', value: 'Back at 3pm' },
    ]);
    expect(s.switches.chat).toBe(false);
    expect(s.switches.signups).toBe(true);
    expect(s.cap).toBe(50);
    expect(s.freeLeads).toBe(1);
    expect(s.freeOrders).toBe(10);
    expect(s.prices).toEqual({ MONTHLY: 5900, ANNUAL: 59000 });
    expect(s.banner).toBe('Back at 3pm');
  });

  it('takes a null banner as no banner', () => {
    expect(resolveSettings([{ key: 'banner', value: null }]).banner).toBeNull();
  });

  it.each([
    ['cap', -1],
    ['cap', 0],
    ['cap', '200'],
    ['freeLeads', -1],
    ['freeLeads', 0],
    ['freeOrders', 0],
    ['freeOrders', 1.5],
    ['price.MONTHLY', 49.5],
    ['price.ANNUAL', 99],
    ['switch.chat', 'off'],
    ['banner', 'x'.repeat(BANNER_MAX + 1)],
    ['banner', ''],
    ['banner', 5],
  ])('keeps the default for %s = %j and says so', (key, value) => {
    const onBad = vi.fn();
    expect(resolveSettings([{ key, value }], onBad)).toEqual(defaultSettings());
    expect(onBad).toHaveBeenCalledWith(key);
  });

  it('ignores an unknown key without calling onBad', () => {
    const onBad = vi.fn();
    expect(resolveSettings([{ key: 'mystery', value: 1 }], onBad)).toEqual(defaultSettings());
    expect(onBad).not.toHaveBeenCalled();
  });

  it('accepts a banner of exactly the maximum', () => {
    const banner = 'x'.repeat(BANNER_MAX);
    expect(resolveSettings([{ key: 'banner', value: banner }]).banner).toBe(banner);
  });

  it('does not throw without an onBad', () => {
    expect(() => resolveSettings([{ key: 'cap', value: 'x' }])).not.toThrow();
  });
});

describe('isBigPriceChange', () => {
  it('is true for a rise of more than half', () => {
    expect(isBigPriceChange(4900, 7400)).toBe(true);
  });
  it('is false for a modest rise', () => {
    expect(isBigPriceChange(4900, 5900)).toBe(false);
  });
  it('is true above RM999', () => {
    expect(isBigPriceChange(4900, 100000)).toBe(true);
  });
  it('is true for a drop of more than half', () => {
    expect(isBigPriceChange(4900, 2000)).toBe(true);
  });
  it('is false at exactly half', () => {
    expect(isBigPriceChange(4900, 7350)).toBe(false);
  });
});

describe('a malformed cap override', () => {
  const was = process.env.CONVERSATION_CAP_PER_MONTH;
  beforeEach(() => {
    process.env.CONVERSATION_CAP_PER_MONTH = 'abc';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    if (was === undefined) delete process.env.CONVERSATION_CAP_PER_MONTH;
    else process.env.CONVERSATION_CAP_PER_MONTH = was;
    vi.restoreAllMocks();
  });

  it('does not stop defaultSettings(), resolveSettings() or the cache', async () => {
    expect(defaultSettings().cap).toBe(200);
    expect(resolveSettings([]).cap).toBe(200);
    const cache = createSettingsCache(async () => {
      throw new Error('down');
    });
    expect((await cache.get()).cap).toBe(200);
  });

  it('warns once per process, not on every read', async () => {
    // A fresh copy of the module, so a warning an earlier test drew does not count here.
    vi.resetModules();
    const fresh = await import('./settings.js');
    fresh.defaultSettings();
    fresh.defaultSettings();
    fresh.resolveSettings([]);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });
});

describe('fallbackSettings', () => {
  it('is the defaults, marked, without the mark showing in a copy or a comparison', () => {
    const f = fallbackSettings();
    expect(f).toEqual(defaultSettings());
    expect(isFallbackSettings(f)).toBe(true);
    expect(isFallbackSettings(defaultSettings())).toBe(false);
    expect(Object.keys(f)).toEqual(Object.keys(defaultSettings()));
    expect(JSON.parse(JSON.stringify(f))).toEqual(defaultSettings());
  });
});

describe('createSettingsCache', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('asks once per window when the first load fails', async () => {
    const load = vi.fn(async (): Promise<ReturnType<typeof defaultSettings>> => {
      throw new Error('down');
    });
    const cache = createSettingsCache(load, { ttlMs: 1_000 });
    await cache.get();
    await cache.get();
    await cache.get();
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_500);
    await cache.get();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('marks the defaults it falls back to on a cold failure, and only those', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue(defaultSettings());
    const cache = createSettingsCache(load, { ttlMs: 1_000 });
    const cold = await cache.get();
    expect(cold).toEqual(defaultSettings());
    expect(isFallbackSettings(cold)).toBe(true);
    // Cached as a fallback for the window, so every reader in it sees the mark.
    expect(isFallbackSettings(await cache.get())).toBe(true);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(isFallbackSettings(await cache.get())).toBe(false);
  });

  it('does not mark the last good value it keeps serving after a failure', async () => {
    const good = { ...defaultSettings(), cap: 80 };
    const load = vi.fn().mockResolvedValueOnce(good).mockRejectedValue(new Error('down'));
    const cache = createSettingsCache(load, { ttlMs: 1_000 });
    await cache.get();
    await vi.advanceTimersByTimeAsync(1_500);
    const kept = await cache.get();
    expect(kept.cap).toBe(80);
    expect(isFallbackSettings(kept)).toBe(false);
  });

  it('shares one load between gets that arrive while the expired value is being refreshed', async () => {
    let release: (s: ReturnType<typeof defaultSettings>) => void = () => {};
    const fresh = { ...defaultSettings(), cap: 33 };
    const load = vi
      .fn()
      .mockResolvedValueOnce(defaultSettings())
      .mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const cache = createSettingsCache(load, { ttlMs: 1_000 });
    await cache.get();
    await vi.advanceTimersByTimeAsync(1_500);

    const during = [cache.get(), cache.get(), cache.get()];
    release(fresh);
    expect((await Promise.all(during)).map((s) => s.cap)).toEqual([33, 33, 33]);
    expect((await cache.get()).cap).toBe(33);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('still settles, and loads again next window, when onError itself throws', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue({ ...defaultSettings(), cap: 44 });
    const cache = createSettingsCache(load, {
      ttlMs: 1_000,
      onError: () => {
        throw new Error('the logger broke');
      },
    });
    expect(isFallbackSettings(await cache.get())).toBe(true);
    await vi.advanceTimersByTimeAsync(1_500);
    expect((await cache.get()).cap).toBe(44);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not let a load that was running at clear() write its old answer back', async () => {
    let release: (s: ReturnType<typeof defaultSettings>) => void = () => {};
    const old = { ...defaultSettings(), cap: 11 };
    const fresh = { ...defaultSettings(), cap: 22 };
    const load = vi
      .fn()
      .mockImplementationOnce(() => new Promise((resolve) => (release = resolve)))
      .mockResolvedValue(fresh);
    const cache = createSettingsCache(load);
    const first = cache.get();
    cache.clear();
    release(old);
    await first;
    expect((await cache.get()).cap).toBe(22);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
