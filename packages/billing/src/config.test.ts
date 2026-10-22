import { describe, expect, it } from 'vitest';
import { CHIP_DEFAULT_BASE_URL, CHIP_ENV, billingDisabled } from './config.js';

const everySetting = Object.fromEntries(CHIP_ENV.map((name) => [name, 'set']));

describe('billingDisabled', () => {
  it('billing is off in development only when every CHIP_* setting is unset', () => {
    expect(billingDisabled({ NODE_ENV: 'development' })).toBe(true);
    // `pnpm dev` runs tsx and next without setting NODE_ENV at all.
    expect(billingDisabled({})).toBe(true);
    expect(billingDisabled({ NODE_ENV: 'development', ...everySetting })).toBe(false);
    const blank = Object.fromEntries(CHIP_ENV.map((name) => [name, '']));
    expect(billingDisabled({ NODE_ENV: 'development', ...blank })).toBe(true);
  });

  // Half a configuration is a mistake. Treated as "on", so the startup check
  // names the missing setting instead of billing silently disappearing.
  it('a partial set is not off', () => {
    expect(billingDisabled({ NODE_ENV: 'development', CHIP_SECRET_KEY: 'set' })).toBe(false);
    expect(billingDisabled({ CHIP_CALLBACK_BASE_URL: 'set' })).toBe(false);
  });

  // The deploy must fail on a missing key, not an owner's payment.
  it('production is never off', () => {
    expect(billingDisabled({ NODE_ENV: 'production' })).toBe(false);
  });

  it('names the settings that decide it, and the default API root', () => {
    expect([...CHIP_ENV]).toEqual(['CHIP_SECRET_KEY', 'CHIP_BRAND_ID', 'CHIP_CALLBACK_BASE_URL']);
    expect(CHIP_DEFAULT_BASE_URL).toBe('https://gate.chip-in.asia/api/v1');
  });
});
