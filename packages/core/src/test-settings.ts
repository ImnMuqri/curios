import { defaultSettings, type Settings } from './settings.js';

/**
 * Settings after an admin raised the Business monthly price to RM59, for the tests that check a price
 * change reaches the page, mail or charge it belongs to. Test code only: nothing ships through here.
 * `over` is laid on top, for the tests that also change the free allowances.
 */
export function raisedSettings(over: Partial<Settings> = {}): Settings {
  const base = defaultSettings();
  return { ...base, prices: { ...base.prices, MONTHLY: 5900 }, ...over };
}
