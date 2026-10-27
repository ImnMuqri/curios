/**
 * The one way money is written. Imports nothing, like store.ts: client components load it through
 * `@curios/core/money`, and the barrel reaches `node:crypto`.
 */

/**
 * Integer sen as ringgit the way a price is published: RM49, RM49.50 (never RM49.5), RM1,234.56.
 * Whole ringgit carry no decimals.
 */
export function ringgit(cents: number): string {
  const whole = Math.trunc(cents / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const sen = Math.abs(cents % 100);
  return sen === 0 ? `RM${whole}` : `RM${whole}.${sen.toString().padStart(2, '0')}`;
}
