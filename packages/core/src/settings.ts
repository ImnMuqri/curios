import { conversationCap, FREE_CONVERSATIONS_PER_MONTH } from './cap.js';
import { PLAN_PRICES_CENTS } from './billing.js';
import { FREE_LEADS, FREE_ORDERS } from './plan.js';

/** The admin's kill switches. A switch that is off stops that thing; every one is on by default. */
export type SwitchKey = 'chat' | 'signups' | 'reading' | 'chipPayments' | 'ownerEmails';
/** The numbers the admin can change, named as the audit log names them. */
export type LimitKey = 'cap' | 'freeLeads' | 'freeOrders' | 'monthlyCents' | 'annualCents';

export interface Settings {
  switches: Record<SwitchKey, boolean>;
  cap: number;
  freeLeads: number;
  freeOrders: number;
  prices: { MONTHLY: number; ANNUAL: number };
  banner: string | null;
}

/** What a plan costs and allows: the part of `Settings` that pricing copy, Terms and mails print. */
export type PlanTerms = Pick<Settings, 'freeLeads' | 'freeOrders' | 'prices'>;

export const BANNER_MAX = 160;
/** Above this a price change is "big" and the admin must confirm it. */
export const PRICE_MAX_RM = 999;

const SWITCH_KEYS: readonly SwitchKey[] = ['chat', 'signups', 'reading', 'chipPayments', 'ownerEmails'];

/**
 * What every setting is when no row says otherwise. The constants stay where they are and are the
 * defaults: a table nobody has written to behaves exactly as the code did before there was one.
 */
export function defaultSettings(): Settings {
  // conversationCap() throws on a malformed override, which the API wants at boot; here it must not,
  // or a typo in the environment would take every settings read down with it.
  let cap = FREE_CONVERSATIONS_PER_MONTH;
  try {
    cap = conversationCap();
  } catch (err) {
    console.warn('CONVERSATION_CAP_PER_MONTH is malformed; the default cap applies', err);
  }
  return {
    switches: { chat: true, signups: true, reading: true, chipPayments: true, ownerEmails: true },
    cap,
    freeLeads: FREE_LEADS,
    freeOrders: FREE_ORDERS,
    prices: { MONTHLY: PLAN_PRICES_CENTS.MONTHLY, ANNUAL: PLAN_PRICES_CENTS.ANNUAL },
    banner: null,
  };
}

/**
 * The mark on settings that are the defaults only because nothing could be read. Non-enumerable and
 * keyed by a registered symbol, so the object compares, spreads into JSON and prints as plain
 * defaults, and the mark survives being handed from module to module.
 */
const FALLBACK = Symbol.for('curios.settings.fallback');

/** The defaults, marked as a fallback: what a reader gives when the stored settings can't be read. */
export function fallbackSettings(): Settings {
  const s = defaultSettings();
  Object.defineProperty(s, FALLBACK, { value: true, enumerable: false });
  return s;
}

/**
 * True when these are the defaults standing in for settings that could not be read. Anything that
 * charges money (a plan purchase, an auto-renewal) refuses these: the defaults may not be the prices
 * the admin set. Reading paths (copy, limits, switches) use them as they are.
 */
export function isFallbackSettings(s: Settings): boolean {
  return (s as unknown as Record<symbol, unknown>)[FALLBACK] === true;
}

const isInt = (v: unknown, min: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min;

/**
 * Stored rows laid over the defaults. Never throws: a row whose value has the wrong shape (someone
 * edited the table by hand) keeps that key's default and is reported through `onBad`, because a
 * broken setting must not take the site down. Unknown keys are ignored without a word.
 */
export function resolveSettings(
  rows: { key: string; value: unknown }[],
  onBad: (key: string) => void = () => {},
): Settings {
  const s = defaultSettings();
  for (const { key, value } of rows) {
    let ok = true;
    if (key.startsWith('switch.')) {
      const name = key.slice('switch.'.length) as SwitchKey;
      if (!SWITCH_KEYS.includes(name)) continue;
      if (typeof value === 'boolean') s.switches[name] = value;
      else ok = false;
    } else if (key === 'cap') {
      if (isInt(value, 1)) s.cap = value;
      else ok = false;
    } else if (key === 'freeLeads') {
      // At least 1: a trial with no free lead or order would stop at its first one.
      if (isInt(value, 1)) s.freeLeads = value;
      else ok = false;
    } else if (key === 'freeOrders') {
      if (isInt(value, 1)) s.freeOrders = value;
      else ok = false;
    } else if (key === 'price.MONTHLY' || key === 'price.ANNUAL') {
      if (isInt(value, 100)) s.prices[key === 'price.MONTHLY' ? 'MONTHLY' : 'ANNUAL'] = value;
      else ok = false;
    } else if (key === 'banner') {
      if (value === null) s.banner = null;
      else if (typeof value === 'string' && value.length >= 1 && value.length <= BANNER_MAX) s.banner = value;
      else ok = false;
    } else continue;
    if (!ok) onBad(key);
  }
  return s;
}

/** A price move the admin has to confirm: past RM999, or by more than half of the old price. */
export function isBigPriceChange(oldCents: number, newCents: number): boolean {
  return newCents > PRICE_MAX_RM * 100 || Math.abs(newCents - oldCents) > oldCents / 2;
}

export interface SettingsCache {
  get(): Promise<Settings>;
  clear(): void;
}

/**
 * The 30-second cache both readers share (the API's in @curios/db, the web's in @curios/db-read).
 * Concurrent gets share one load. A failed load keeps serving the last good value, or the defaults
 * when there has been none, and tells `onError`; it is not retried until the TTL has passed, so a
 * database that is down is asked once per window, not once per request. Those defaults are marked
 * (`isFallbackSettings`), so a charge can refuse them; a last good value is not marked.
 */
export function createSettingsCache(
  load: () => Promise<Settings>,
  opts: { ttlMs?: number; onError?: (err: unknown) => void } = {},
): SettingsCache {
  const ttlMs = opts.ttlMs ?? 30_000;
  let value: Settings | null = null;
  let expiresAt = 0;
  let inflight: Promise<Settings> | null = null;
  // Bumped by clear(), so a load that was already running when it was called cannot write its
  // older answer back over a cache the writer has just emptied.
  let generation = 0;
  return {
    get() {
      if (value && Date.now() < expiresAt) return Promise.resolve(value);
      if (inflight) return inflight;
      const mine = generation;
      const settle = (result: Settings): Settings => {
        if (mine === generation) {
          // A fallback is cached too, so a database that is down is asked once per window.
          value = result;
          expiresAt = Date.now() + ttlMs;
          inflight = null;
        }
        return result;
      };
      inflight = load().then(settle, (err: unknown) => {
        opts.onError?.(err);
        return settle(value ?? fallbackSettings());
      });
      return inflight;
    },
    clear() {
      generation += 1;
      value = null;
      expiresAt = 0;
      inflight = null;
    },
  };
}
