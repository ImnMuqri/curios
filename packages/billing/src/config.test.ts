import { describe, expect, it } from 'vitest';
import { BILLPLZ_ENV, billingDisabled } from './config.js';

const everySetting = Object.fromEntries(BILLPLZ_ENV.map((name) => [name, 'set']));

describe('billingDisabled', () => {
  it('switches billing off in development when nothing Billplz is set', () => {
    expect(billingDisabled({ NODE_ENV: 'development' })).toBe(true);
  });

  // `pnpm dev` runs tsx and next without setting NODE_ENV at all.
  it('treats an unset NODE_ENV as development', () => {
    expect(billingDisabled({})).toBe(true);
  });

  // The deploy must fail on a missing key, not an owner's payment.
  it('never switches billing off in production', () => {
    expect(billingDisabled({ NODE_ENV: 'production' })).toBe(false);
  });

  it('keeps billing on when everything is set', () => {
    expect(billingDisabled({ NODE_ENV: 'development', ...everySetting })).toBe(false);
  });

  // Half a configuration is a mistake. Treated as "on", so the startup check
  // names the missing setting instead of billing silently disappearing.
  it('keeps billing on when only some settings are set', () => {
    expect(billingDisabled({ NODE_ENV: 'development', BILLPLZ_API_KEY: 'set' })).toBe(false);
    expect(billingDisabled({ BILLPLZ_REDIRECT_URL: 'set' })).toBe(false);
  });

  it('treats an empty value as unset', () => {
    const blank = Object.fromEntries(BILLPLZ_ENV.map((name) => [name, '']));
    expect(billingDisabled({ NODE_ENV: 'development', ...blank })).toBe(true);
  });
});
