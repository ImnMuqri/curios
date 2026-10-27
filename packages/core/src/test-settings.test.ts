import { describe, expect, it } from 'vitest';
import { defaultSettings } from './settings.js';
import { raisedSettings } from './test-settings.js';

describe('raisedSettings', () => {
  it('is the defaults with the monthly price at RM59, and takes overrides', () => {
    expect(raisedSettings()).toEqual({ ...defaultSettings(), prices: { ...defaultSettings().prices, MONTHLY: 5900 } });
    expect(raisedSettings({ freeLeads: 5 }).freeLeads).toBe(5);
    expect(raisedSettings({ freeLeads: 5 }).prices.MONTHLY).toBe(5900);
  });
});
