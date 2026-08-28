import type { TokenUsage } from './types.js';

/**
 * Bump this whenever a rate below changes. ModelCall stores it alongside the
 * computed cost so historical rows stay accurate under new pricing and margins
 * can be recomputed without a backfill.
 */
export const PRICE_VERSION = '2026-08-28';

/** Milli-cents per million tokens. 1 cent = 1000 milli-cents. */
interface Rates {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

const RATES: Record<string, Rates> = {
  // $1 / $5 per million.
  'claude-haiku-4-5': { input: 100_000, output: 500_000, cacheRead: 10_000, cacheWrite: 125_000 },
  // $5 / $25 per million.
  'claude-opus-5': { input: 500_000, output: 2_500_000, cacheRead: 50_000, cacheWrite: 625_000 },
};

export function costFor(
  model: string,
  usage: TokenUsage,
): { costMilliCents: number; priceVersion: string } {
  // RATES is a plain object literal: looking a model up with a bare index
  // access falls through to Object.prototype for a name like "constructor"
  // or "toString", returning a truthy non-Rates value instead of missing --
  // which bypasses the throw below and prices the call as NaN. hasOwn checks
  // only RATES's own keys.
  if (!Object.hasOwn(RATES, model)) throw new Error(`Unknown model for pricing: ${model}`);
  const rates = RATES[model]!;

  const total =
    usage.inputTokens * rates.input +
    usage.outputTokens * rates.output +
    usage.cacheReadTokens * rates.cacheRead +
    usage.cacheWriteTokens * rates.cacheWrite;

  return { costMilliCents: Math.round(total / 1_000_000), priceVersion: PRICE_VERSION };
}
